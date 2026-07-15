/**
 * Google Sheets Queue Service — async, queue-based Sheets sync.
 *
 * Firestore is ALWAYS the source of truth.
 * Google Sheets is a secondary sync target for reporting/organizer views.
 *
 * Expected Google Sheet Header Layouts:
 *
 * 1. Onboarding Sheet (GOOGLE_SHEET_ONBOARDING_ID):
 *    - Team Name, leaderName, leaderEmail, leaderWhatsapp, leaderCollege, leaderCourse,
 *      leaderGradYear, leaderGithub, leaderLinkedin,
 *      member2Name, member2Email, member2Whatsapp, member2College, member2Course, member2GradYear, member2Role, member2Github, member2Linkedin,
 *      member3Name, member3Email, member3Whatsapp, member3College, member3Course, member3GradYear, member3Role, member3Github, member3Linkedin,
 *      member4Name, member4Email, member4Whatsapp, member4College, member4Course, member4GradYear, member4Role, member4Github, member4Linkedin,
 *      teamStatus, registrationLockedAt
 *
 * 2. PPT Submission Sheet (GOOGLE_SHEET_PPT_ID):
 *    - Team Name, Team ID, Round ID, Submitted At, PPT Link
 *
 * 3. Prototype Submission Sheet (GOOGLE_SHEET_PROTO_ID):
 *    - Team Name, Team ID, Round ID, Submitted At, Prototype Link
 *
 * 4. GitHub Submission Sheet (Default/General):
 *    - Team Name, Team ID, Round ID, Submitted At, GitHub Link, Demo Link
 *
 * Flow:
 *   1. Submission saved to Firestore
 *   2. createSyncJob() writes to googleSheets/{jobId} with status: 'pending'
 *   3. POST /api/internal/sheets-worker picks up pending jobs and syncs to Sheets
 *
 * Failure in Sheets sync NEVER blocks a submission.
 *
 * @module server/services/sheets-queue.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { env } from '@/lib/env';
import { writeAuditLog } from './audit.service';
import type { SheetsSyncStatus } from '@/types/index';

// ─── Create Sync Job ──────────────────────────────────────────────────────────

export interface CreateSyncJobOptions {
  sheetId: string;
  sheetName: string;
  teamId: string;
  teamName: string;
  roundId: string;
  /** Key-value data to append as a row. Order preserved. */
  data: Record<string, string | number>;
  createdBy?: string;
}

/**
 * Creates a pending Google Sheets sync job.
 * The actual Sheets write happens asynchronously in the sheets-worker.
 */
export async function createSyncJob(opts: CreateSyncJobOptions): Promise<string> {
  const db = getAdminDb();

  const docRef = await db.collection('googleSheets').add({
    sheetId: opts.sheetId,
    sheetName: opts.sheetName,
    teamId: opts.teamId,
    teamName: opts.teamName,
    roundId: opts.roundId,
    data: opts.data,
    status: 'pending' as SheetsSyncStatus,
    attempts: 0,
    maxAttempts: env.SHEETS_QUEUE_MAX_ATTEMPTS ?? 3,
    lastAttemptAt: null,
    syncedAt: null,
    error: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: opts.createdBy ?? 'system',
  });

  return docRef.id;
}

// ─── Process Queue ─────────────────────────────────────────────────────────────

export interface SheetsProcessResult {
  processed: number;
  synced: number;
  failed: number;
  retried: number;
}

export async function isSheetsSyncLocked(): Promise<boolean> {
  const db = getAdminDb();
  const lockSnap = await db.collection('settings').doc('sheets-sync-lock').get();
  if (lockSnap.exists) {
    const data = lockSnap.data()!;
    if (data.locked === true) {
      const lockedAt = data.lockedAt;
      const diffMs = Date.now() - (lockedAt?.toMillis() || 0);
      // 5 minutes lock expiration
      if (diffMs < 5 * 60 * 1000) {
        return true;
      }
    }
  }
  return false;
}

export async function acquireSheetsSyncLock(uid: string): Promise<void> {
  const db = getAdminDb();
  await db.collection('settings').doc('sheets-sync-lock').set({
    locked: true,
    lockedAt: FieldValue.serverTimestamp(),
    lockedBy: uid,
  });
}

export async function releaseSheetsSyncLock(): Promise<void> {
  const db = getAdminDb();
  await db.collection('settings').doc('sheets-sync-lock').update({
    locked: false,
    releasedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Processes pending Google Sheets sync jobs.
 * Called by POST /api/internal/sheets-worker.
 */
export async function processSheetsQueue(): Promise<SheetsProcessResult> {
  const db = getAdminDb();

  // Check if sheets sync is paused in settings
  const settingsSnap = await db.collection('settings').doc('platform').get();
  if (settingsSnap.exists) {
    const data = settingsSnap.data()!;
    if (data['emergencyMode'] === true || data['sheetsPaused'] === true) {
      console.log('[sheets-queue] Sheets sync processing is paused due to emergency/maintenance settings.');
      return { processed: 0, synced: 0, failed: 0, retried: 0 };
    }
  }

  const batchSize = env.SHEETS_QUEUE_BATCH_SIZE ?? 10;
  const maxAttempts = env.SHEETS_QUEUE_MAX_ATTEMPTS ?? 3;

  const snap = await db
    .collection('googleSheets')
    .where('status', 'in', ['pending', 'retry'])
    .orderBy('createdAt')
    .limit(batchSize)
    .get();

  const result: SheetsProcessResult = { processed: 0, synced: 0, failed: 0, retried: 0 };

  for (const doc of snap.docs) {
    const data = doc.data();
    result.processed++;

    // Mark as syncing
    await doc.ref.update({
      status: 'syncing',
      lastAttemptAt: FieldValue.serverTimestamp(),
    });

    try {
      await upsertToSheet(data.sheetId, data.sheetName, data.teamName, data.roundId, data.data);

      await doc.ref.update({
        status: 'synced',
        syncedAt: FieldValue.serverTimestamp(),
        attempts: FieldValue.increment(1),
        error: null,
      });

      result.synced++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const currentAttempts = (data.attempts as number) + 1;

      if (currentAttempts >= maxAttempts) {
        await doc.ref.update({
          status: 'failed',
          error: errorMsg,
          attempts: FieldValue.increment(1),
        });

        await writeAuditLog({
          action: 'mail.job_failed', // reuse closest — no sheets-specific audit action needed
          actorUid: 'system',
          actorRole: 'system',
          targetId: doc.id,
          targetType: 'googleSheets',
          metadata: { sheetId: data.sheetId, teamId: data.teamId, roundId: data.roundId, error: errorMsg },
          ip: null,
        });

        result.failed++;
      } else {
        const backoffMs = Math.pow(2, currentAttempts) * 60 * 1000;
        await doc.ref.update({
          status: 'retry',
          error: errorMsg,
          attempts: FieldValue.increment(1),
          scheduledFor: new Date(Date.now() + backoffMs),
        });
        result.retried++;
      }
    }
  }

  return result;
}

// ─── Sheets Writer ────────────────────────────────────────────────────────────

/**
 * Upserts a row to a Google Sheet via the googleapis SDK.
 * Prevents duplicate rows by using Team Name and optionally Round ID as a composite key.
 * Uses service account from GOOGLE_SERVICE_ACCOUNT_JSON env var.
 */
async function upsertToSheet(
  sheetId: string,
  sheetName: string,
  teamName: string,
  roundId: string,
  data: Record<string, string | number>,
): Promise<void> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured.');
  }

  // Dynamic import to avoid bundling googleapis when not configured
  const { google } = await import('googleapis');

  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Build row as ordered values
  const row = [teamName, ...Object.values(data)];

  // 1. Fetch existing rows to find a match
  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${sheetName}!A:Z`,
  });

  const existingRows = getRes.data.values || [];
  let foundIndex = -1;

  for (let i = 0; i < existingRows.length; i++) {
    const existingRow = existingRows[i];
    if (existingRow && existingRow[0] === teamName) {
      if (roundId === 'onboarding') {
        foundIndex = i;
        break;
      } else {
        // For submissions, Column C (index 2) is the round ID.
        if (existingRow[2] === roundId) {
          foundIndex = i;
          break;
        }
      }
    }
  }

  if (foundIndex >= 0) {
    // 2. Update existing row (Google Sheets uses 1-based indexing)
    const targetRange = `${sheetName}!A${foundIndex + 1}:Z${foundIndex + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: targetRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  } else {
    // 3. Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  }
}

// ─── Status / Admin Views ─────────────────────────────────────────────────────

/**
 * Lists sync jobs with optional status filter. Paginated.
 */
export async function listSyncJobs(opts: {
  status?: SheetsSyncStatus | SheetsSyncStatus[];
  limit?: number;
  startAfter?: string;
}): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const limit = opts.limit ?? 20;

  let query = db.collection('googleSheets').orderBy('createdAt', 'desc');

  if (opts.status) {
    const statusArray = Array.isArray(opts.status) ? opts.status : [opts.status];
    query = query.where('status', 'in', statusArray) as typeof query;
  }

  if (opts.startAfter) {
    const cursorSnap = await db.collection('googleSheets').doc(opts.startAfter).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap) as typeof query;
  }

  const snap = await query.limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
