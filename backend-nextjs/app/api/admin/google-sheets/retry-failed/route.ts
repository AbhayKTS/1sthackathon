/**
 * POST /api/admin/google-sheets/retry-failed
 *
 * Secure endpoint for admins to reset all failed Google Sheets synchronization jobs.
 * Re-queues only jobs with status = 'failed' by setting their status to 'pending',
 * attempts back to 0, and clearing any error messages.
 * Requires admin or super_admin role.
 *
 * @route POST /api/admin/google-sheets/retry-failed
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '@/server/services/audit.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    // 1. Authenticate and authorize (admin or super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const db = getAdminDb();

    // 2. Fetch all failed jobs
    const failedJobsSnap = await db.collection('googleSheets')
      .where('status', '==', 'failed')
      .get();

    let updatedCount = 0;

    if (!failedJobsSnap.empty) {
      const batchPromises: Array<Promise<any>> = [];
      let batch = db.batch();
      let count = 0;

      for (const doc of failedJobsSnap.docs) {
        batch.update(doc.ref, {
          status: 'pending',
          attempts: 0,
          error: null,
          scheduledFor: FieldValue.delete(), // clean up scheduledFor backoff if any
        });
        count++;

        if (count === 500) {
          batchPromises.push(batch.commit());
          batch = db.batch();
          count = 0;
        }
      }

      if (count > 0) {
        batchPromises.push(batch.commit());
      }

      await Promise.all(batchPromises);
      updatedCount = failedJobsSnap.size;

      // 3. Log admin operation in audit trails
      await writeAuditLog({
        action: 'team.updated', // reuse closest
        actorUid: token.uid,
        actorRole: token.role,
        targetId: 'googleSheets',
        targetType: 'googleSheets',
        metadata: {
          action: 'retry_failed_sheets_sync_jobs',
          triggeredBy: token.email,
          updatedCount,
        },
        ip: null,
      }).catch((err) => {
        console.error('Failed to write audit log for retry failed:', err);
      });
    }

    const response = apiSuccess({
      success: true,
      updatedCount,
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
