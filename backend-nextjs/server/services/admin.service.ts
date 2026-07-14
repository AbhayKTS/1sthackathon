/**
 * Admin Service — Admin operations (team verification, announcements).
 *
 * The old reviewTeam() (approve/reject/needChanges) is kept for backward compat
 * but teams now primarily flow through the invitation-based onboarding system.
 *
 * @module server/services/admin.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import { createNotification } from './notification.service';
import { createMailJob } from './mail-queue.service';
import { env, getPortalBaseUrl } from '@/lib/env';

// ─── Team Verification (new admin-driven flow) ────────────────────────────────

/**
 * Admin marks a team as Verified.
 * This is the final admin action — team is now active and can participate.
 */
export async function verifyTeam(adminUid: string, teamId: string): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();

  if (!snap.exists) throw Errors.notFound('Team not found.');

  const teamData = snap.data()!;

  await teamRef.update({
    status: 'Verified',
    verifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update corresponding invitedTeam
  if (teamData['invitedTeamId']) {
    await db.collection('invitedTeams').doc(teamData['invitedTeamId'] as string).update({
      status: 'Verified',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await writeAuditLog({
    action: 'team.verified',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: teamId,
    targetType: 'teams',
    metadata: { teamName: teamData['teamName'] },
    ip: null,
  });
}

// ─── Time Leap / Finalist Flags ───────────────────────────────────────────────

/**
 * Admin sets Time Leap eligibility for a team.
 */
export async function setTimeLeapEligible(
  adminUid: string,
  teamId: string,
  eligible: boolean,
): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (!snap.exists) throw Errors.notFound('Team not found.');

  await teamRef.update({
    isTimeLeapEligible: eligible,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'team.timeleap_eligible_set',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: teamId,
    targetType: 'teams',
    metadata: { eligible },
    ip: null,
  });
}

/**
 * Admin bulk-sets Time Leap eligibility for multiple teams.
 */
export async function bulkSetTimeLeapEligible(
  adminUid: string,
  teamIds: string[],
  eligible: boolean,
): Promise<void> {
  const db = getAdminDb();
  const CHUNK = 450;

  for (let i = 0; i < teamIds.length; i += CHUNK) {
    const chunk = teamIds.slice(i, i + CHUNK);
    const batch = db.batch();

    for (const teamId of chunk) {
      const ref = db.collection('teams').doc(teamId);
      batch.update(ref, {
        isTimeLeapEligible: eligible,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
  }

  await writeAuditLog({
    action: 'team.timeleap_eligible_set',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: 'bulk',
    targetType: 'teams',
    metadata: { teamIds, eligible, count: teamIds.length },
    ip: null,
  });
}

/**
 * Admin sets finalist flags.
 */
export async function setFinalistFlags(
  adminUid: string,
  teamId: string,
  flags: { isFinalist?: boolean; isTimeLeapQualified?: boolean },
): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (!snap.exists) throw Errors.notFound('Team not found.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { updatedAt: FieldValue.serverTimestamp() };
  if (flags.isFinalist !== undefined) update.isFinalist = flags.isFinalist;
  if (flags.isTimeLeapQualified !== undefined) update.isTimeLeapQualified = flags.isTimeLeapQualified;

  await teamRef.update(update);

  await writeAuditLog({
    action: 'team.finalist_set',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: teamId,
    targetType: 'teams',
    metadata: { flags },
    ip: null,
  });
}

// ─── Announcements ────────────────────────────────────────────────────────────

export interface CreateAnnouncementInput {
  title: string;
  message: string;
  channels: {
    portal?: boolean;
    email?: boolean;
    discord?: boolean;
    whatsapp?: boolean;
  };
}

/**
 * Creates an announcement and broadcasts to all configured channels.
 * Each channel is independently try/catch wrapped — failure in one never blocks others.
 */
export async function createAnnouncement(
  adminUid: string,
  input: CreateAnnouncementInput,
): Promise<string> {
  const db = getAdminDb();

  // Check if announcements are paused
  const settingsSnap = await db.collection('settings').doc('platform').get();
  if (settingsSnap.exists) {
    const data = settingsSnap.data()!;
    if (data['emergencyMode'] === true || data['announcementsPaused'] === true) {
      throw Errors.forbidden('Announcements and broadcasting are currently paused by the system administrator.');
    }
  }

  const channels = {
    portal: input.channels.portal ?? true,
    email: input.channels.email ?? false,
    discord: input.channels.discord ?? false,
    whatsapp: input.channels.whatsapp ?? false,
  };

  const docRef = await db.collection('announcements').add({
    title: input.title.trim(),
    message: input.message.trim(),
    timestamp: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: null,
    updatedAt: null,
    isVisible: channels.portal,
    version: 1,
    channels,
  });

  await writeAuditLog({
    action: 'announcement.created',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: docRef.id,
    targetType: 'announcements',
    metadata: { title: input.title, channels },
    ip: null,
  });

  // ── Discord broadcast (non-blocking) ───────────────────────────────────────
  if (channels.discord && env.DISCORD_WEBHOOK_URL) {
    fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: `📢 ${input.title}`,
          description: input.message,
          color: 0xe50914,
          footer: { text: 'RevengersHack Portal' },
          timestamp: new Date().toISOString(),
        }],
      }),
    }).catch((err) => {
      console.error('[admin.service] Discord webhook failed (non-fatal):', err?.message);
    });
  }

  // ── WhatsApp broadcast (non-blocking, when provider configured) ────────────
  if (channels.whatsapp && env.WHATSAPP_API_TOKEN && env.WHATSAPP_API_URL) {
    fetch(env.WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.WHATSAPP_API_TOKEN}`,
      },
      body: JSON.stringify({
        text: `*${input.title}*\n\n${input.message}`,
      }),
    }).catch((err) => {
      console.error('[admin.service] WhatsApp broadcast failed (non-fatal):', err?.message);
    });
  }

  // ── Email broadcast to all Verified teams' leaders (queue-based) ───────────
  if (channels.email) {
    const teamsSnap = await db
      .collection('teams')
      .where('status', '==', 'Verified')
      .select('leaderEmail', 'teamName')
      .get();

    const loginUrl = getPortalBaseUrl();

    const emailJobs = teamsSnap.docs.map((d) => ({
      to: d.data()['leaderEmail'] as string,
      template: 'announcement' as const,
      variables: {
        title: input.title,
        message: input.message,
        loginUrl,
        teamName: d.data()['teamName'] as string,
      },
      priority: 'normal' as const,
      createdBy: adminUid,
    }));

    if (emailJobs.length > 0) {
      const { createMailJobs } = await import('./mail-queue.service');
      await createMailJobs(emailJobs).catch((err) => {
        console.error('[admin.service] Failed to queue announcement emails:', err);
      });
    }
  }

  return docRef.id;
}

/**
 * Edits an existing announcement.
 */
export async function editAnnouncement(
  adminUid: string,
  annId: string,
  title: string,
  message: string,
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('announcements').doc(annId);
  const snap = await ref.get();

  if (!snap.exists) throw Errors.notFound('Announcement not found.');

  await ref.update({
    title: title.trim(),
    message: message.trim(),
    updatedBy: adminUid,
    updatedAt: FieldValue.serverTimestamp(),
    version: FieldValue.increment(1),
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
 * Soft-deletes an announcement (sets isVisible: false).
 */
export async function deleteAnnouncement(adminUid: string, annId: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('announcements').doc(annId);

  await ref.update({
    isVisible: false,
    updatedBy: adminUid,
    updatedAt: FieldValue.serverTimestamp(),
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

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Gets platform settings.
 */
export async function getSettings(): Promise<Record<string, unknown>> {
  const db = getAdminDb();
  const snap = await db.collection('settings').doc('platform').get();
  if (!snap.exists) return {};
  return snap.data() ?? {};
}

/**
 * Updates platform settings. Only super_admin should call this.
 */
export async function updateSettings(
  adminUid: string,
  input: Record<string, unknown>,
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('settings').doc('platform');

  await ref.set(
    { ...input, updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid },
    { merge: true }
  );

  await writeAuditLog({
    action: 'settings.updated',
    actorUid: adminUid,
    actorRole: 'super_admin',
    targetId: 'platform',
    targetType: 'settings',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}

// ─── Legacy (kept for backward compat) ───────────────────────────────────────

export type ReviewAction = 'approve' | 'reject' | 'needChanges';

export interface ReviewTeamInput {
  teamId: string;
  action: ReviewAction;
  notes?: string;
  lastUpdatedAt: number;
}

/**
 * @deprecated Use the new invitation-based onboarding flow instead.
 * Kept for backward compatibility with existing API routes.
 */
export async function reviewTeam(adminUid: string, input: ReviewTeamInput): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(input.teamId);

  if (input.action === 'needChanges' && !input.notes) {
    throw Errors.validation('Notes are required when requesting changes.');
  }

  let teamName = 'Unknown Team';
  let leaderId = '';

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw Errors.notFound('Team not found.');

    const teamData = snap.data()!;
    teamName = teamData['teamName'] ?? 'Unknown Team';
    leaderId = teamData['leaderId'] ?? '';
    const invitedTeamId = teamData['invitedTeamId'] as string | null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { updatedAt: FieldValue.serverTimestamp() };

    if (input.action === 'approve') {
      updateData.status = 'Approved';
      updateData.verifiedAt = FieldValue.serverTimestamp();
    } else if (input.action === 'reject') {
      updateData.status = 'Rejected';
      updateData.adminNotes = input.notes ?? null;
    } else if (input.action === 'needChanges') {
      updateData.status = 'NeedChanges';
      updateData.adminNotes = input.notes ?? null;
      updateData.needChangesHistory = FieldValue.arrayUnion({
        note: input.notes,
        at: new Date(),
        byAdminUid: adminUid,
      });
    }

    tx.update(teamRef, updateData);

    if (invitedTeamId) {
      const inviteRef = db.collection('invitedTeams').doc(invitedTeamId);
      if (input.action === 'approve') {
        tx.update(inviteRef, {
          status: 'Approved',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (input.action === 'reject') {
        tx.update(inviteRef, {
          status: 'Rejected',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (input.action === 'needChanges') {
        tx.update(inviteRef, {
          status: 'Incomplete',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  });

  await writeAuditLog({
    action: input.action === 'approve' ? 'team.verified' : 'team.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: input.teamId,
    targetType: 'teams',
    metadata: { action: input.action, notes: input.notes },
    ip: null,
  });

  // Send notification if leader exists
  if (leaderId) {
    try {
      const userSnap = await db.collection('users').doc(leaderId).get();
      if (userSnap.exists) {
        const leaderEmail = userSnap.data()!.email as string;
        const loginUrl = `${getPortalBaseUrl()}/login`;

        if (input.action === 'approve') {
          await createNotification({
            userId: leaderId,
            type: 'team_approved',
            title: 'Clearance Granted',
            message: 'Your team has been verified. The dashboard is now fully unlocked.'
          });
          await createMailJob({ to: leaderEmail, template: 'approved', variables: { teamName, loginUrl }, createdBy: adminUid });
        } else if (input.action === 'needChanges') {
          await createNotification({
            userId: leaderId,
            type: 'team_need_changes',
            title: 'Intel Required',
            message: 'Admin has requested changes to your profile.'
          });
          await createMailJob({ to: leaderEmail, template: 'need_changes', variables: { teamName, notes: input.notes ?? '', loginUrl }, createdBy: adminUid });
        }
      }
    } catch (err) {
      console.error('[admin.service] Failed to send review notifications:', err);
    }
  }
}

// ─── Old activateRound helper — kept as shim ─────────────────────────────────

/**
 * @deprecated Use round-state.service.ts transitionRound() instead.
 */
export async function activateRound(
  adminUid: string,
  roundId: string,
  roundTitle: string,
  roundDesc: string,
): Promise<void> {
  const { transitionRound, updateRound } = await import('./round-state.service');
  const db = getAdminDb();
  const snap = await db.collection('rounds').doc(roundId).get();

  if (!snap.exists) {
    // Create the round first
    const { createRound } = await import('./round-state.service');
    await createRound(adminUid, {
      roundId,
      title: roundTitle,
      description: roundDesc,
      type: 'general',
      submissionType: 'github_link',
    });
    await transitionRound(adminUid, roundId, 'Published');
    await transitionRound(adminUid, roundId, 'Active');
  } else {
    const current = snap.data()!;
    if (current['status'] === 'Draft') {
      await transitionRound(adminUid, roundId, 'Published');
      await transitionRound(adminUid, roundId, 'Active');
    } else if (current['status'] === 'Published') {
      await transitionRound(adminUid, roundId, 'Active');
    }
    await updateRound(adminUid, roundId, { title: roundTitle, description: roundDesc });
  }
}
