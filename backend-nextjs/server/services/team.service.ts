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
