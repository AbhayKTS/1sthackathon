/**
 * Submission Service — handles team payload submissions.
 *
 * Branching by round `submissionType`:
 *   - 'ppt_link'        → accepts pptLink
 *   - 'prototype_link'  → accepts prototypeLink OR hasNoPrototype:true
 *   - 'github_link'     → accepts githubLink + optional demoLink
 *   - 'none'            → no team submission (sessions assigned by admin)
 *
 * Google Sheets sync:
 *   - Creates a job in googleSheets collection (via sheets-queue.service)
 *   - Worker processes the job asynchronously
 *   - Firestore is ALWAYS the source of truth
 *
 * Immutability:
 *   - Once status is 'Submitted', the document is immutable from client
 *   - Re-submission updates in place (upsert) while round is Active/unlocked
 *   - After round is Locked, no new submissions accepted
 *
 * @module server/services/submission.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import { createTeamNotification } from './notification.service';
import { createSyncJob } from './sheets-queue.service';
import { env } from '@/lib/env';
import type { SubmissionType, RoundStatus } from '@/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmitPayloadInput {
  teamId: string;
  roundId: string;
  githubLink?: string;
  demoLink?: string;
  pptLink?: string;
  prototypeLink?: string;
  hasNoPrototype?: boolean;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitPayload(userUid: string, input: SubmitPayloadInput): Promise<void> {
  const db = getAdminDb();

  // Check if submissions are paused
  const settingsSnap = await db.collection('settings').doc('platform').get();
  if (settingsSnap.exists) {
    const data = settingsSnap.data()!;
    if (data['maintenanceMode'] === true || data['emergencyMode'] === true || data['submissionsPaused'] === true) {
      throw Errors.forbidden('Submissions are currently paused by the system administrator.');
    }
  }

  // 1. Verify team is Verified and caller is team leader
  const teamRef = db.collection('teams').doc(input.teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) throw Errors.notFound('Team not found.');

  const teamData = teamSnap.data()!;

  if (teamData['status'] !== 'Verified') {
    throw Errors.validation(
      `Your team is currently '${teamData['status']}' and cannot submit. Complete registration first.`
    );
  }

  if (teamData['leaderId'] !== userUid) {
    throw Errors.forbidden('Only the team leader can submit the payload.');
  }
  // 1b. Verify existing submission is not locked
  const submissionId = `${input.teamId}_${input.roundId}`;
  const submissionRef = db.collection('submissions').doc(submissionId);
  const existingSubSnap = await submissionRef.get();

  if (existingSubSnap.exists) {
    const existingData = existingSubSnap.data()!;
    if (existingData.status === 'Locked' || existingData.lockedAt !== null) {
      throw Errors.forbidden('This submission has been locked for evaluation and cannot be altered.');
    }
  }
  // 2. Verify round is Active and not Locked
  const roundRef = db.collection('rounds').doc(input.roundId);
  const roundSnap = await roundRef.get();

  if (!roundSnap.exists) throw Errors.notFound('Round not found.');

  const roundData = roundSnap.data()!;
  const roundStatus = (roundData['status'] ?? 'Draft') as RoundStatus;

  if (roundStatus !== 'Active') {
    throw Errors.validation(
      roundStatus === 'Draft' || roundStatus === 'Published'
        ? 'This round has not started yet.'
        : `This round is in '${roundStatus}' status and is no longer accepting submissions.`
    );
  }

  // 3. Check submission deadline
  if (roundData['submissionDeadline']) {
    const deadlineMs =
      roundData['submissionDeadline'].toMillis
        ? roundData['submissionDeadline'].toMillis()
        : new Date(roundData['submissionDeadline']).getTime();

    if (Date.now() > deadlineMs) {
      throw Errors.validation('The submission deadline for this round has passed.');
    }
  }

  // 4. Check allowedTeams
  const allowedTeams = roundData['allowedTeams'] as 'all' | string[];
  if (allowedTeams !== 'all' && Array.isArray(allowedTeams) && !allowedTeams.includes(input.teamId)) {
    throw Errors.forbidden('Your team is not eligible for this round.');
  }

  // 5. Branch by submissionType and build submission document
  const submissionType = (roundData['submissionType'] ?? 'github_link') as SubmissionType;
  const teamName: string = teamData['teamName'] ?? '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const submissionDoc: any = {
    teamId: input.teamId,
    roundId: input.roundId,
    submittedBy: userUid,
    submissionType,
    roundType: roundData['type'] ?? 'general',  // legacy compat
    status: 'Submitted',
    submittedAt: FieldValue.serverTimestamp(),
    lockedAt: null,
    pptLink: null,
    prototypeLink: null,
    hasNoPrototype: false,
    githubLink: null,
    demoLink: null,
  };

  let sheetSyncData: Record<string, string | number> | null = null;
  const sheetId = roundData['googleSheetId'] ?? null;

  const submittedAtIso = new Date().toISOString();

  switch (submissionType) {
    case 'ppt_link': {
      if (!input.pptLink?.trim()) {
        throw Errors.validation('A PPT link (Canva / Google Slides) is required for this round.');
      }
      submissionDoc.pptLink = input.pptLink.trim();
      sheetSyncData = {
        teamId: input.teamId,
        roundId: input.roundId,
        submittedAt: submittedAtIso,
        pptLink: input.pptLink.trim(),
      };
      break;
    }

    case 'prototype_link': {
      if (!input.hasNoPrototype && !input.prototypeLink?.trim()) {
        throw Errors.validation(
          'Please provide a prototype link, or check "No prototype yet" to indicate your status.'
        );
      }
      submissionDoc.prototypeLink = input.prototypeLink?.trim() ?? null;
      submissionDoc.hasNoPrototype = !!input.hasNoPrototype;
      sheetSyncData = {
        teamId: input.teamId,
        roundId: input.roundId,
        submittedAt: submittedAtIso,
        prototypeLink: input.prototypeLink?.trim() ?? '(no prototype)',
      };
      break;
    }

    case 'none': {
      throw Errors.validation(
        'Teams do not submit links for this round. Your session will be assigned by the admin.'
      );
    }

    default: {
      if (!input.githubLink?.trim()) {
        throw Errors.validation('A GitHub link is required for this round.');
      }
      submissionDoc.githubLink = input.githubLink.trim();
      submissionDoc.demoLink = input.demoLink?.trim() ?? null;
      sheetSyncData = {
        teamId: input.teamId,
        roundId: input.roundId,
        submittedAt: submittedAtIso,
        githubLink: input.githubLink.trim(),
        demoLink: input.demoLink?.trim() ?? '',
      };
      break;
    }
  }

  // 6. Upsert submission doc (composite ID = idempotent re-submit)
  await submissionRef.set(submissionDoc, { merge: true });

  // 7. Queue Google Sheets sync (non-blocking, fallback env vars for sheet ID)
  if (sheetSyncData) {
    const effectiveSheetId =
      sheetId ||
      (submissionType === 'ppt_link' ? env.GOOGLE_SHEET_PPT_ID : null) ||
      (submissionType === 'prototype_link' ? env.GOOGLE_SHEET_PROTO_ID : null) ||
      null;

    if (effectiveSheetId) {
      createSyncJob({
        sheetId: effectiveSheetId,
        sheetName: 'Sheet1',
        teamId: input.teamId,
        teamName,
        roundId: input.roundId,
        data: sheetSyncData,
        createdBy: userUid,
      }).catch(() => {
        // Sync job creation failure is non-fatal
      });
    }
  }

  // 8. Audit log
  const isUpdate = existingSubSnap.exists;
  const oldValues = isUpdate ? existingSubSnap.data() : null;
  await writeAuditLog({
    action: isUpdate ? 'submission.updated' : 'submission.submitted',
    actorUid: userUid,
    actorRole: 'participant_leader',
    targetId: submissionId,
    targetType: 'submissions',
    metadata: {
      teamId: input.teamId,
      roundId: input.roundId,
      submissionType,
      ...(isUpdate && {
        oldFields: {
          pptLink: oldValues?.pptLink || null,
          prototypeLink: oldValues?.prototypeLink || null,
          githubLink: oldValues?.githubLink || null,
          demoLink: oldValues?.demoLink || null,
        },
        newFields: {
          pptLink: submissionDoc.pptLink || null,
          prototypeLink: submissionDoc.prototypeLink || null,
          githubLink: submissionDoc.githubLink || null,
          demoLink: submissionDoc.demoLink || null,
        }
      })
    },
    ip: null,
  });

  // 9. In-app notification
  await createTeamNotification(
    input.teamId,
    'submission_received',
    'Transmission Received',
    `Your payload for round ${input.roundId} has been successfully transmitted.`
  );
}

// ─── List Submissions ─────────────────────────────────────────────────────────

/**
 * Gets all submissions for a team.
 */
export async function getTeamSubmissions(teamId: string): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const snap = await db
    .collection('submissions')
    .where('teamId', '==', teamId)
    .orderBy('submittedAt', 'desc')
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Gets all submissions for a round. Admin only.
 */
export async function getRoundSubmissions(
  roundId: string,
  opts?: { limit?: number; startAfter?: string }
): Promise<{ submissions: Array<Record<string, unknown>>; hasMore: boolean }> {
  const db = getAdminDb();
  const limit = opts?.limit ?? 50;

  let query = db
    .collection('submissions')
    .where('roundId', '==', roundId)
    .orderBy('submittedAt')
    .limit(limit + 1);

  if (opts?.startAfter) {
    const cursor = await db.collection('submissions').doc(opts.startAfter).get();
    if (cursor.exists) query = query.startAfter(cursor) as typeof query;
  }

  const snap = await query.get();
  const hasMore = snap.docs.length > limit;

  return {
    submissions: snap.docs.slice(0, limit).map((d) => ({ id: d.id, ...d.data() })),
    hasMore,
  };
}
