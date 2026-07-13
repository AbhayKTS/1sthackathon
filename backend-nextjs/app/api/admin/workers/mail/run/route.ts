/**
 * POST /api/admin/workers/mail/run
 *
 * Secure endpoint for Super Admins to manually trigger processing of the mail queue.
 * Requires super_admin role.
 *
 * @route POST /api/admin/workers/mail/run
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { processMailQueue } from '@/server/services/mail-queue.service';
import { setWorkerStatus, setWorkerResult } from '@/server/services/worker-stats.service';
import { writeAuditLog } from '@/server/services/audit.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    // 1. Authenticate and authorize (super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const startedAt = new Date();

    // 2. Track worker execution state
    await setWorkerStatus('mail', 'PROCESSING');

    let result;
    try {
      // 3. Process mail queue
      result = await processMailQueue();
      await setWorkerResult('mail', result.processed, result.failed, null);
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await setWorkerResult('mail', 0, 1, errorMsg);
      throw err;
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // 4. Log admin operation in audit trails
    await writeAuditLog({
      action: 'mail.job_processed',
      actorUid: token.uid,
      actorRole: token.role,
      targetId: 'mailQueue',
      targetType: 'mailQueue',
      metadata: {
        action: 'manual_mail_queue_run',
        triggeredBy: token.email,
        processed: result.processed,
        sent: result.sent,
        failed: result.failed,
        retried: result.retried,
        durationMs,
      },
      ip: null,
    }).catch((err) => {
      console.error('Failed to write audit log for manual mail queue sync:', err);
    });

    const response = apiSuccess({
      success: true,
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
      retried: result.retried,
      durationMs,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
