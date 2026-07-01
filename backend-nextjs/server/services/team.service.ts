/**
 * Team Service — manages team profile submission and updates.
 *
 * @module server/services/team.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';

export interface TeamMember {
  name: string;
  email: string;
  phone: string;
  role: string;
}

export interface TeamProfileInput {
  teamName: string;
  college: string;
  members: TeamMember[]; // 2 to 5 members including leader
}

/**
 * Submits or updates the team profile.
 * Only the participant_leader can perform this action.
 */
export async function submitTeamProfile(
  uid: string,
  invitedTeamId: string,
  input: TeamProfileInput
): Promise<string> {
  const db = getAdminDb();

  if (!input.members || input.members.length < 2 || input.members.length > 5) {
    throw Errors.validation('A team must have between 2 and 5 members.');
  }

  // Use a transaction to ensure atomic updates to both Users and Teams
  const teamId = await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) {
      throw Errors.unauthorized('User record not found.');
    }

    const userData = userSnap.data()!;
    let currentTeamId = userData['teamId'] as string | null;

    // Create a new team doc if they don't have one
    let teamRef;
    if (currentTeamId) {
      teamRef = db.collection('teams').doc(currentTeamId);
    } else {
      teamRef = db.collection('teams').doc();
      currentTeamId = teamRef.id;
    }

    const teamData = {
      teamName: input.teamName,
      college: input.college,
      leaderId: uid,
      invitedTeamId,
      members: input.members,
      status: 'Submitted', // Requires Admin approval
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!userData['teamId']) {
      // First time submission
      tx.set(teamRef, {
        ...teamData,
        createdAt: FieldValue.serverTimestamp(),
      });
      // Update User doc to link the team
      tx.update(userRef, {
        teamId: currentTeamId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Upsert
      tx.set(teamRef, teamData, { merge: true });
    }

    // Update InvitedTeams status to Submitted if it exists
    if (invitedTeamId) {
      const inviteRef = db.collection('invitedTeams').doc(invitedTeamId);
      tx.update(inviteRef, { status: 'Submitted', updatedAt: FieldValue.serverTimestamp() });
    }

    return currentTeamId;
  });

  await writeAuditLog({
    action: 'team.profile_submitted',
    actorUid: uid,
    actorRole: 'participant_leader',
    targetId: teamId,
    targetType: 'teams',
    metadata: { teamName: input.teamName, memberCount: input.members.length },
    ip: null,
  });

  return teamId;
}

/**
 * Updates an existing team profile.
 * Only allowed if the team is in 'Incomplete' status (or hasn't been submitted fully, though here it must exist).
 */
export async function updateTeamDetails(
  uid: string,
  input: Partial<TeamProfileInput>
): Promise<void> {
  const db = getAdminDb();

  if (input.members && (input.members.length < 2 || input.members.length > 5)) {
    throw Errors.validation('A team must have between 2 and 5 members.');
  }

  await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) {
      throw Errors.unauthorized('User record not found.');
    }

    const userData = userSnap.data()!;
    const currentTeamId = userData['teamId'] as string | null;

    if (!currentTeamId) {
      throw Errors.validation('No team profile found to update.');
    }

    const teamRef = db.collection('teams').doc(currentTeamId);
    const teamSnap = await tx.get(teamRef);

    if (!teamSnap.exists) {
      throw Errors.notFound('Team not found.');
    }

    const teamData = teamSnap.data()!;

    if (teamData['leaderId'] !== uid) {
      throw Errors.forbidden('Only the team leader can update the profile.');
    }

    if (teamData['status'] === 'Submitted' || teamData['status'] === 'Approved' || teamData['status'] === 'Rejected') {
      throw Errors.forbidden(`Team profile is locked because it is currently '${teamData['status']}'.`);
    }

    const updateData: any = { updatedAt: FieldValue.serverTimestamp() };
    if (input.teamName) updateData.teamName = input.teamName;
    if (input.college) updateData.college = input.college;
    if (input.members) updateData.members = input.members;

    // If it was incomplete and they update, we switch it back to 'Submitted' so admins can review again.
    // Or we leave it as Incomplete and require a distinct submission? 
    // Usually if they fix it, it goes back into the queue. Let's set it to 'Submitted'.
    updateData.status = 'Submitted';

    tx.update(teamRef, updateData);

    if (teamData['invitedTeamId']) {
      const inviteRef = db.collection('invitedTeams').doc(teamData['invitedTeamId']);
      tx.update(inviteRef, { status: 'Submitted', updatedAt: FieldValue.serverTimestamp() });
    }
  });

  const userSnap = await db.collection('users').doc(uid).get();
  const teamId = userSnap.data()?.['teamId'];

  await writeAuditLog({
    action: 'team.updated',
    actorUid: uid,
    actorRole: 'participant_leader',
    targetId: teamId,
    targetType: 'teams',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}
