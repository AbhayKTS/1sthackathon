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

  // Ensure caller is the team leader
  if (teamData['leaderId'] !== userUid) {
      throw Errors.unauthorized("Only the team leader can submit the payload.");
  }

  // 1.5 Verify round deadline
  const roundRef = db.collection('rounds').doc(input.roundId);
  const roundSnap = await roundRef.get();
  
  if (!roundSnap.exists) {
      throw Errors.notFound("Round not found.");
  }
  
  const roundData = roundSnap.data()!;
  if (!roundData.isActive) {
      throw Errors.validation("This round is not currently active.");
  }
  
  if (roundData.submissionDeadline) {
      const deadlineMs = roundData.submissionDeadline.toMillis 
          ? roundData.submissionDeadline.toMillis() 
          : new Date(roundData.submissionDeadline).getTime();
          
      if (Date.now() > deadlineMs) {
          throw Errors.validation("The submission deadline for this round has passed.");
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
    status: 'Submitted',
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
