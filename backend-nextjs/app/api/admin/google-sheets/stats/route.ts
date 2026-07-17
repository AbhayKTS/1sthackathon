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

    // 2. Query stats — use .get() to avoid requiring composite Firestore indexes
    const allJobsSnap = await db.collection('googleSheets').get();
    const allJobs = allJobsSnap.docs.map(d => d.data());

    const pending = allJobs.filter(j => j.status === 'pending').length;
    const retry   = allJobs.filter(j => j.status === 'retry').length;
    const failed  = allJobs.filter(j => j.status === 'failed').length;
    const synced  = allJobs.filter(j => j.status === 'synced').length;

    // 3. Find last sync timestamp — sort in JS, no index needed
    const syncedJobs = allJobs
      .filter(j => j.status === 'synced' && j.syncedAt)
      .sort((a, b) => {
        const toMs = (v: unknown) => {
          if (!v) return 0;
          if (typeof (v as any).toMillis === 'function') return (v as any).toMillis();
          if (typeof (v as any).seconds === 'number') return (v as any).seconds * 1000;
          return new Date(v as any).getTime() || 0;
        };
        return toMs(b.syncedAt) - toMs(a.syncedAt);
      });

    const latestSynced = syncedJobs[0];

    let lastSync: string | null = null;
    if (latestSynced) {
      const syncedAt = latestSynced.syncedAt;
      try {
        if (typeof (syncedAt as any).toDate === 'function') {
          lastSync = (syncedAt as any).toDate().toISOString();
        } else if (typeof (syncedAt as any).seconds === 'number') {
          lastSync = new Date((syncedAt as any).seconds * 1000).toISOString();
        } else if (typeof syncedAt === 'string' || typeof syncedAt === 'number') {
          const d = new Date(syncedAt);
          if (!isNaN(d.getTime())) lastSync = d.toISOString();
        }
      } catch (e) {
        console.warn('[SheetsStats] Invalid syncedAt date', syncedAt);
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
