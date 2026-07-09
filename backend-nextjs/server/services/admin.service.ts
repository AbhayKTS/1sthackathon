/**
 * Admin Service — logic for admin operations (reviewing teams, etc.)
 *
 * @module server/services/admin.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog, type AuditAction } from './audit.service';
import { createTeamNotification } from './notification.service';
import { sendEmail } from './email.service';
import { env } from '@/lib/env';

export type ReviewAction = 'approve' | 'reject' | 'needChanges';

export interface ReviewTeamInput {
  teamId: string;
  action: ReviewAction;
  notes?: string;
  lastUpdatedAt: number; // Client sends timestamp ms for optimistic lock
}

/**
 * Reviews a team profile submission.
 * Uses optimistic locking to prevent concurrent admin overwrites.
 */
export async function reviewTeam(adminUid: string, input: ReviewTeamInput): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(input.teamId);

  if (input.action === 'needChanges' && !input.notes) {
    throw Errors.validation("Notes are required when requesting changes.");
  }

  let leaderId = '';
  let teamName = 'Hacker';

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) {
      throw Errors.notFound("Team not found.");
    }

    const teamData = snap.data()!;
    leaderId = teamData['leaderId'];
    teamName = teamData['teamName'] || 'Hacker';
    const serverUpdatedAt = teamData['updatedAt'];
    let serverUpdatedMs = 0;

    if (serverUpdatedAt) {
        // Handle Firestore Timestamp or standard JS Date fallback
        serverUpdatedMs = serverUpdatedAt.toMillis 
            ? serverUpdatedAt.toMillis() 
            : new Date(serverUpdatedAt).getTime();
    }

    // Optimistic lock check (allow a 5000ms drift/delay window to prevent overly strict failures)
    if (serverUpdatedMs > 0 && Math.abs(serverUpdatedMs - input.lastUpdatedAt) > 5000) {
      throw Errors.conflict("The team profile was modified by someone else since you loaded it. Please refresh and try again.");
    }

    if (teamData['status'] !== 'Submitted') {
      throw Errors.validation(`Cannot review a team that is currently in '${teamData['status']}' state.`);
    }

    let newStatus = teamData['status'];
    const updateData: any = { updatedAt: FieldValue.serverTimestamp() };

    switch (input.action) {
      case 'approve':
        newStatus = 'Approved';
        break;
      case 'reject':
        newStatus = 'Rejected';
        break;
      case 'needChanges':
        newStatus = 'Incomplete';
        updateData.needChangesHistory = FieldValue.arrayUnion({
          notes: input.notes,
          timestamp: new Date().toISOString(),
          reviewedBy: adminUid
        });
        break;
    }

    updateData.status = newStatus;
    tx.update(teamRef, updateData);

    // If approved or rejected, we should also update invitedTeams (optional, but good for tracking)
    if (teamData['invitedTeamId']) {
        const inviteRef = db.collection('invitedTeams').doc(teamData['invitedTeamId']);
        tx.update(inviteRef, { status: newStatus, updatedAt: FieldValue.serverTimestamp() });
    } else if (newStatus === 'Approved') {
        const inviteRef = db.collection('invitedTeams').doc();
        tx.set(inviteRef, {
            teamName: teamName,
            leaderName: teamData['leaderName'] || 'Unknown',
            leaderEmail: teamData['leaderEmail'] ? teamData['leaderEmail'].toLowerCase().trim() : '',
            status: 'Approved',
            importedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        updateData.invitedTeamId = inviteRef.id;
    }
  });

  const auditActionMap: Record<ReviewAction, AuditAction> = {
    approve: 'team.approved',
    reject: 'team.rejected',
    needChanges: 'team.need_changes'
  };

  await writeAuditLog({
    action: auditActionMap[input.action],
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: input.teamId,
    targetType: 'teams',
    metadata: { action: input.action, notes: input.notes || null },
    ip: null,
  });

  // Notifications and Emails
  try {
      if (leaderId) {
          const userSnap = await db.collection('users').doc(leaderId).get();
          if (userSnap.exists) {
              const leaderEmail = userSnap.data()!.email;
              const baseUrl = process.env.NODE_ENV === 'production' ? 'https://revengershack.tech' : (env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173');
              const loginUrl = `${baseUrl}/login`;

              if (input.action === 'approve') {
                  await createTeamNotification(input.teamId, 'team_approved', 'Clearance Granted', 'Your team profile has been approved. The dashboard is now fully unlocked.');
                  await sendEmail({ to: leaderEmail, template: 'approved', variables: { teamName, loginUrl } }).catch(console.error);
              } else if (input.action === 'reject') {
                  await createTeamNotification(input.teamId, 'team_rejected', 'Clearance Denied', 'Your team application has been rejected by central command.');
                  await sendEmail({ to: leaderEmail, template: 'rejected', variables: { teamName } }).catch(console.error);
              } else if (input.action === 'needChanges') {
                  await createTeamNotification(input.teamId, 'team_need_changes', 'Intel Required', 'Admin has requested changes to your team profile. Please address them and resubmit.');
                  await sendEmail({ to: leaderEmail, template: 'needChanges', variables: { teamName, notes: input.notes || '', loginUrl } }).catch(console.error);
              }
          }
      }
  } catch (e) {
      console.error("Failed to send review notifications/emails", e);
  }
}

/**
 * Activates a specific round and deactivates all currently active rounds.
 * Removed hardcoded ["round-1","round-2","round-3"] constraint — any roundId accepted.
 */
export async function activateRound(adminUid: string, roundId: string, roundTitle: string, roundDesc: string): Promise<void> {
  const db = getAdminDb();

  const batch = db.batch();

  // Deactivate currently active rounds
  const activeSnap = await db.collection('rounds').where('isActive', '==', true).get();
  activeSnap.docs.forEach(doc => {
    if (doc.id !== roundId) {
      batch.update(doc.ref, { isActive: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid });
    }
  });

  // Activate (or create) the target round
  const targetRef = db.collection('rounds').doc(roundId);
  batch.set(targetRef, {
    isActive: true,
    title: roundTitle,
    description: roundDesc,
    isLocked: false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUid,
  }, { merge: true });

  await batch.commit();

  await writeAuditLog({
    action: 'round.activated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: roundId,
    targetType: 'rounds',
    metadata: { roundTitle },
    ip: null,
  });
}


/**
 * Deactivates all rounds without activating any.
 * Dynamic — reads currently active rounds rather than hardcoded IDs.
 */
export async function deactivateAllRounds(adminUid: string): Promise<void> {
  const db = getAdminDb();

  const activeSnap = await db.collection('rounds').where('isActive', '==', true).get();

  const batch = db.batch();
  activeSnap.docs.forEach(doc => {
    batch.update(doc.ref, {
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUid,
    });
  });

  if (activeSnap.docs.length > 0) {
    await batch.commit();
  }

  await writeAuditLog({
    action: 'round.activated', // reuse closest; deactivateAllRounds is still a round state change
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: 'all',
    targetType: 'rounds',
    metadata: { deactivatedCount: activeSnap.docs.length },
    ip: null,
  });
}

/**
 * Broadcasts an announcement to all teams.
 * After writing to Firestore, fires Discord webhook (if configured) and
 * WhatsApp stub (pending provider confirmation).
 * Each broadcast channel is independently try/catch wrapped — failure in one
 * channel never blocks the Firestore write or other channels.
 */
export async function createAnnouncement(adminUid: string, title: string, message: string): Promise<void> {
  const db = getAdminDb();
  
  const docRef = await db.collection('announcements').add({
    title,
    message,
    timestamp: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: null,
    updatedAt: null,
    isVisible: true,
    version: 1
  });

  await writeAuditLog({
    action: 'announcement.created',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: docRef.id,
    targetType: 'announcements',
    metadata: { title },
    ip: null,
  });

  // ── Discord broadcast ───────────────────────────────────────────────────────
  // Non-blocking: runs in background after response has been sent
  if (env.DISCORD_WEBHOOK_URL) {
    fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: `📢 ${title}`,
          description: message,
          color: 0xe50914, // RevengersHack red
          footer: { text: 'RevengersHack Portal' },
          timestamp: new Date().toISOString(),
        }],
      }),
    }).catch((err) => {
      console.error('[admin.service] Discord webhook failed (non-fatal):', err?.message);
    });
  }

  // ── WhatsApp broadcast (STUB — provider not yet confirmed) ─────────────────
  // TODO: Replace with actual WhatsApp API call once provider & token confirmed.
  // if (env.WHATSAPP_API_TOKEN) {
  //   postToWhatsApp({ token: env.WHATSAPP_API_TOKEN, message: `${title}\n\n${message}` });
  // }
}

/**
 * Edits an existing announcement.
 */
export async function editAnnouncement(adminUid: string, annId: string, title: string, message: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('announcements').doc(annId);

  await ref.update({
    title,
    message,
    updatedBy: adminUid,
    updatedAt: FieldValue.serverTimestamp(),
    version: FieldValue.increment(1)
  });

  await writeAuditLog({
    action: 'announcement.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: annId,
    targetType: 'announcements',
    metadata: { title },
    ip: null,
  });
}

/**
 * Soft deletes an announcement.
 */
export async function deleteAnnouncement(adminUid: string, annId: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('announcements').doc(annId);

  await ref.update({
    isVisible: false,
    updatedBy: adminUid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog({
    action: 'announcement.deleted',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: annId,
    targetType: 'announcements',
    metadata: {},
    ip: null,
  });
}
