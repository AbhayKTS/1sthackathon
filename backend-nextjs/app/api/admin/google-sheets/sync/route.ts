/**
 * POST /api/admin/google-sheets/sync
 *
 * Secure endpoint for Super Admins to manually trigger Google Sheets synchronization.
 * Prevents concurrent syncs unless forced by a Super Admin.
 *
 * @route POST /api/admin/google-sheets/sync
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  isSheetsSyncLocked,
  acquireSheetsSyncLock,
  releaseSheetsSyncLock,
  processSheetsQueue,
} from '@/server/services/sheets-queue.service';
import { writeAuditLog } from '@/server/services/audit.service';
import { setWorkerStatus, setWorkerResult } from '@/server/services/worker-stats.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    // 1. Authenticate and authorize (super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    // 2. Check synchronization lock
    const isLocked = await isSheetsSyncLocked();
    if (isLocked && !force) {
      const response = NextResponse.json(
        {
          success: false,
          message: 'Synchronization already in progress.',
        },
        { status: 409 }
      );
      return applyCorsHeaders(response, origin);
    }

    // 3. Acquire synchronization lock
    await acquireSheetsSyncLock(token.uid);
    await setWorkerStatus('sheets', 'PROCESSING');

    const startedAt = new Date();
    let res;
    try {
      // 4. Process the Google Sheets sync queue
      res = await processSheetsQueue();
      await setWorkerResult('sheets', res.processed, res.failed, null);
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await setWorkerResult('sheets', 0, 1, errorMsg);
      throw err;
    } finally {
      // 5. Release synchronization lock (always runs even if sync throws)
      await releaseSheetsSyncLock();
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    const db = getAdminDb();
    // 6. Query remaining pending and retry counts
    const [pendingCountSnap, retryCountSnap] = await Promise.all([
      db.collection('googleSheets').where('status', '==', 'pending').count().get(),
      db.collection('googleSheets').where('status', '==', 'retry').count().get(),
    ]);

    const pending = pendingCountSnap.data().count;
    const retry = retryCountSnap.data().count;

    // 7. Write audit log entry (sync history)
    await writeAuditLog({
      action: 'sheets.sync',
      actorUid: token.uid,
      actorRole: token.role,
      targetId: 'googleSheets',
      targetType: 'googleSheets',
      metadata: {
        triggeredBy: token.email,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
        processed: res.processed,
        synced: res.synced,
        failed: res.failed,
        retried: res.retried,
        forced: force,
      },
      ip: null,
    }).catch((err) => {
      console.error('Failed to write audit log for sheets sync:', err);
    });

    const response = apiSuccess({
      success: true,
      processed: res.processed,
      synced: res.synced,
      failed: res.failed,
      pending,
      retry,
      durationMs,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
