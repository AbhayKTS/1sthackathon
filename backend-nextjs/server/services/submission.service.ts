/**
 * Submission Service — handles team payload submissions
 *
 * @module server/services/submission.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';

export interface SubmitPayloadInput {
  teamId: string;
  roundId: string;
  githubLink: string;
  demoLink?: string;
}

export async function submitPayload(userUid: string, input: SubmitPayloadInput): Promise<void> {
  const db = getAdminDb();
  
  // 1. Verify user is on the team and team is approved
  const teamRef = db.collection('teams').doc(input.teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) {
    throw Errors.notFound("Team not found.");
  }

  const teamData = teamSnap.data()!;
  
  if (teamData['status'] !== 'Approved') {
    throw Errors.validation(`Your team is currently '${teamData['status']}' and cannot submit. Contact admin.`);
  }

  // Ensure caller is the leader (or at least a member, we'll check if they are the leader)
  if (teamData['leaderId'] !== userUid) {
     // Check if they are a member
     const isMember = teamData['members']?.some((m: any) => m.email && m.email.length > 0);
     if (!isMember) {
        throw Errors.unauthorized("You are not authorized to submit for this team.");
     }
  }

  // 2. Upsert submission document using composite ID
  const submissionId = `${input.teamId}_${input.roundId}`;
  const submissionRef = db.collection('submissions').doc(submissionId);

  await submissionRef.set({
    teamId: input.teamId,
    roundId: input.roundId,
    githubLink: input.githubLink,
    demoLink: input.demoLink || null,
    submittedBy: userUid,
    submittedAt: FieldValue.serverTimestamp()
  }, { merge: true }); // Merge so we don't destroy any admin-added metadata if they exist

  // 3. Write Audit Log
  await writeAuditLog({
    action: 'submission.submitted',
    actorUid: userUid,
    actorRole: 'participant',
    targetId: submissionId,
    targetType: 'submissions',
    metadata: {
      teamId: input.teamId,
      roundId: input.roundId,
      githubLink: input.githubLink
    },
    ip: null,
  });
}
