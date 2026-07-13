/**
 * GET /api/admin/google-sheets/stats
 *
 * Secure endpoint for admins to retrieve current Google Sheets synchronization metrics.
 * Requires admin or super_admin role.
 *
 * @route GET /api/admin/google-sheets/stats
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';
import { isSheetsSyncLocked } from '@/server/services/sheets-queue.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    // 1. Authenticate and authorize (admin or super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const db = getAdminDb();

    // 2. Query stats efficiently using count()
    const [pendingCountSnap, retryCountSnap, failedCountSnap, syncedCountSnap] = await Promise.all([
      db.collection('googleSheets').where('status', '==', 'pending').count().get(),
      db.collection('googleSheets').where('status', '==', 'retry').count().get(),
      db.collection('googleSheets').where('status', '==', 'failed').count().get(),
      db.collection('googleSheets').where('status', '==', 'synced').count().get(),
    ]);

    const pending = pendingCountSnap.data().count;
    const retry = retryCountSnap.data().count;
    const failed = failedCountSnap.data().count;
    const synced = syncedCountSnap.data().count;

    // 3. Find last sync timestamp
    const latestSyncedSnap = await db.collection('googleSheets')
      .where('status', '==', 'synced')
      .orderBy('syncedAt', 'desc')
      .limit(1)
      .get();

    let lastSync: string | null = null;
    if (!latestSyncedSnap.empty) {
      const firstDoc = latestSyncedSnap.docs[0];
      if (firstDoc) {
        const data = firstDoc.data();
        const syncedAt = data.syncedAt;
        if (syncedAt) {
          lastSync = typeof (syncedAt as any).toDate === 'function' ? (syncedAt as any).toDate().toISOString() : new Date((syncedAt as any).seconds * 1000).toISOString();
        }
      }
    }

    // 4. Determine sync status (SYNCING / PAUSED / IDLE)
    let status: 'IDLE' | 'SYNCING' | 'PAUSED' = 'IDLE';
    const isLocked = await isSheetsSyncLocked();
    if (isLocked) {
      status = 'SYNCING';
    } else {
      const settingsSnap = await db.collection('settings').doc('platform').get();
      if (settingsSnap.exists) {
        const platformData = settingsSnap.data()!;
        if (platformData.emergencyMode === true || platformData.sheetsPaused === true) {
          status = 'PAUSED';
        }
      }
    }

    const response = apiSuccess({
      pending,
      retry,
      failed,
      synced,
      lastSync,
      status,
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
