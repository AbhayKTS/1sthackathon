/**
 * Submission Service — handles team payload submissions.
 *
 * Branching by round `type`:
 *   - 'ppt'                  → accepts pptLink only
 *   - 'mentoring_prototype'  → accepts prototypeLink OR hasNoPrototype:true
 *   - 'judges_final'         → no team-submitted link (admin-assigned sessions only)
 *   - 'general' / undefined  → legacy githubLink / demoLink behaviour
 *
 * Google Sheets dual-write:
 *   - 'ppt' rounds write to GOOGLE_SHEET_PPT_ID (col A: teamName, col B: pptLink)
 *   - 'mentoring_prototype' rounds write to GOOGLE_SHEET_PROTO_ID (col A: teamName, col B: link)
 *   Sheets write is wrapped in try/catch — failure NEVER blocks the Firestore write.
 *   Sheet IDs are in env vars, never sent to the client.
 *
 * @module server/services/submission.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import { createTeamNotification } from './notification.service';
import { env } from '@/lib/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmitPayloadInput {
  teamId: string;
  roundId: string;
  // General / legacy
  githubLink?: string;
  demoLink?: string;
  // PPT round
  pptLink?: string;
  // Mentoring/prototype round
  prototypeLink?: string;
  hasNoPrototype?: boolean;
}

// ─── Google Sheets Writer ─────────────────────────────────────────────────────

/**
 * Appends a row [teamName, link] to a Google Sheet via the googleapis SDK.
 * Uses a service account stored in GOOGLE_SERVICE_ACCOUNT_JSON env var.
 * NEVER exposes sheet IDs or credentials to the client.
 *
 * Failure is swallowed — Firestore is the source of truth.
 */
async function appendToSheet(sheetId: string, teamName: string, link: string): Promise<void> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.warn('[submission] GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping Sheets write');
    return;
  }

  try {
    // Dynamic import to avoid bundling googleapis when env vars aren't set
    const { google } = await import('googleapis');

    const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:B',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[teamName, link]],
      },
    });

    console.log(`[submission] Sheets write OK — sheet: ${sheetId}, team: ${teamName}`);
  } catch (err) {
    // Sheets failure must NOT block submission
    console.error('[submission] Google Sheets write failed (non-fatal):', err);
  }
}

// ─── Main Submit ──────────────────────────────────────────────────────────────

export async function submitPayload(userUid: string, input: SubmitPayloadInput): Promise<void> {
  const db = getAdminDb();

  // 1. Verify team exists and is Approved
  const teamRef = db.collection('teams').doc(input.teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) throw Errors.notFound('Team not found.');

  const teamData = teamSnap.data()!;

  if (teamData['status'] !== 'Approved') {
    throw Errors.validation(
      `Your team is currently '${teamData['status']}' and cannot submit. Contact admin.`
    );
  }

  if (teamData['leaderId'] !== userUid) {
    throw Errors.forbidden('Only the team leader can submit the payload.');
  }

  // 2. Verify round and check deadline
  const roundRef = db.collection('rounds').doc(input.roundId);
  const roundSnap = await roundRef.get();

  if (!roundSnap.exists) throw Errors.notFound('Round not found.');

  const roundData = roundSnap.data()!;

  if (!roundData.isActive) {
    throw Errors.validation('This round is not currently active.');
  }

  if (roundData.isLocked) {
    throw Errors.validation('This round is locked. Submissions are no longer accepted.');
  }

  if (roundData.submissionDeadline) {
    const deadlineMs =
      roundData.submissionDeadline.toMillis
        ? roundData.submissionDeadline.toMillis()
        : new Date(roundData.submissionDeadline).getTime();

    if (Date.now() > deadlineMs) {
      throw Errors.validation('The submission deadline for this round has passed.');
    }
  }

  // 3. Branch by round type and build submission document
  const roundType: string = roundData.type || 'general';
  const teamName: string = teamData['teamName'] || '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const submissionDoc: any = {
    teamId: input.teamId,
    roundId: input.roundId,
    submittedBy: userUid,
    roundType,
    status: 'Submitted',
    submittedAt: FieldValue.serverTimestamp(),
  };

  let sheetsSheetId: string | null = null;
  let sheetsLink: string | null = null;

  switch (roundType) {
    case 'ppt': {
      if (!input.pptLink?.trim()) {
        throw Errors.validation('A PPT link (Canva / Google Drive) is required for this round.');
      }
      submissionDoc.pptLink = input.pptLink.trim();
      sheetsSheetId = env.GOOGLE_SHEET_PPT_ID || null;
      sheetsLink = input.pptLink.trim();
      break;
    }

    case 'mentoring_prototype': {
      if (!input.hasNoPrototype && !input.prototypeLink?.trim()) {
        throw Errors.validation(
          'Please provide a prototype link, or check "No prototype yet" to indicate your status.'
        );
      }
      submissionDoc.prototypeLink = input.prototypeLink?.trim() || null;
      submissionDoc.hasNoPrototype = !!input.hasNoPrototype;
      submissionDoc.evaluationCategory = input.hasNoPrototype ? 'no_prototype' : 'has_prototype';
      sheetsSheetId = env.GOOGLE_SHEET_PROTO_ID || null;
      sheetsLink = input.prototypeLink?.trim() || '(no prototype)';
      break;
    }

    case 'judges_final': {
      throw Errors.validation(
        'Teams do not submit links for the Judges Evaluation round. Your meeting session will be assigned by the admin.'
      );
    }

    default: {
      // Legacy / 'general' type: githubLink + optional demoLink
      if (!input.githubLink?.trim()) {
        throw Errors.validation('A GitHub link is required for this round.');
      }
      submissionDoc.githubLink = input.githubLink.trim();
      submissionDoc.demoLink = input.demoLink?.trim() || null;
      break;
    }
  }

  // 4. Upsert submission doc (composite ID = idempotent re-submit)
  const submissionId = `${input.teamId}_${input.roundId}`;
  const submissionRef = db.collection('submissions').doc(submissionId);
  await submissionRef.set(submissionDoc, { merge: true });

  // 5. Google Sheets dual-write (async, non-blocking)
  if (sheetsSheetId && sheetsLink) {
    appendToSheet(sheetsSheetId, teamName, sheetsLink).catch(() => {
      // Error already logged inside appendToSheet
    });
  }

  // 6. Audit log
  await writeAuditLog({
    action: 'submission.submitted',
    actorUid: userUid,
    actorRole: 'participant',
    targetId: submissionId,
    targetType: 'submissions',
    metadata: {
      teamId: input.teamId,
      roundId: input.roundId,
      roundType,
    },
    ip: null,
  });

  // 7. In-app notification
  await createTeamNotification(
    input.teamId,
    'submission_received',
    'Transmission Received',
    `Your payload for round ${input.roundId} has been successfully transmitted.`
  );
}
