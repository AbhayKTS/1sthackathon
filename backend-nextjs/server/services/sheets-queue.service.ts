/**
 * Google Sheets Queue Service — async, queue-based Sheets sync.
 *
 * Firestore is ALWAYS the source of truth.
 * Google Sheets is a secondary sync target for reporting/organizer views.
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

/**
 * Processes pending Google Sheets sync jobs.
 * Called by POST /api/internal/sheets-worker.
 */
export async function processSheetsQueue(): Promise<SheetsProcessResult> {
  const db = getAdminDb();
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
      await appendToSheet(data.sheetId, data.sheetName, data.teamName, data.data);

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
 * Appends a row to a Google Sheet via the googleapis SDK.
 * Uses service account from GOOGLE_SERVICE_ACCOUNT_JSON env var.
 */
async function appendToSheet(
  sheetId: string,
  sheetName: string,
  teamName: string,
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

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
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
