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

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) {
      throw Errors.notFound("Team not found.");
    }

    const teamData = snap.data()!;
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

  // Notifications
  if (input.action === 'approve') {
      await createTeamNotification(input.teamId, 'team_approved', 'Clearance Granted', 'Your team profile has been approved. The dashboard is now fully unlocked.');
  } else if (input.action === 'reject') {
      await createTeamNotification(input.teamId, 'team_rejected', 'Clearance Denied', 'Your team application has been rejected by central command.');
  } else if (input.action === 'needChanges') {
      await createTeamNotification(input.teamId, 'team_need_changes', 'Intel Required', 'Admin has requested changes to your team profile. Please address them and resubmit.');
  }
}

/**
 * Activates a specific round and deactivates all others.
 */
export async function activateRound(adminUid: string, roundId: string, roundTitle: string, roundDesc: string): Promise<void> {
  const db = getAdminDb();
  
  // Hardcoded for now based on legacy logic
  const allRoundIds = ["round-1", "round-2", "round-3"];
  if (!allRoundIds.includes(roundId)) {
    throw Errors.validation("Invalid round ID");
  }

  const batch = db.batch();
  
  allRoundIds.forEach(rid => {
    const ref = db.collection('rounds').doc(rid);
    const isActive = rid === roundId;
    
    // We only update the title/desc for the active one to keep it simple, 
    // or just leave them alone and let the UI drive it.
    // The legacy code wrote title/desc to all of them based on a map.
    // We will just do a simple update for isActive.
    batch.set(ref, {
        isActive,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }); // Use merge so we don't destroy title/desc
  });

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
 * Broadcasts an announcement to all teams.
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
