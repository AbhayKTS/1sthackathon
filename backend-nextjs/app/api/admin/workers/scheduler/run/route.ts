/**
 * POST /api/admin/workers/scheduler/run
 *
 * Secure endpoint for Super Admins to manually trigger the timeline scheduler worker.
 * Requires super_admin role.
 *
 * @route POST /api/admin/workers/scheduler/run
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { runSchedulerWorker } from '@/server/services/scheduler-worker.service';
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
    await setWorkerStatus('scheduler', 'PROCESSING');

    let result;
    try {
      // 3. Run scheduler worker
      result = await runSchedulerWorker();
      await setWorkerResult('scheduler', result.processed, 0, null);
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await setWorkerResult('scheduler', 0, 1, errorMsg);
      throw err;
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // 4. Log admin operation in audit trails
    await writeAuditLog({
      action: 'round.transition',
      actorUid: token.uid,
      actorRole: token.role,
      targetId: 'scheduler',
      targetType: 'rounds',
      metadata: {
        action: 'manual_scheduler_run',
        triggeredBy: token.email,
        processed: result.processed,
        activated: result.activated,
        locked: result.locked,
        durationMs,
      },
      ip: null,
    }).catch((err) => {
      console.error('Failed to write audit log for manual scheduler run:', err);
    });

    const response = apiSuccess({
      success: true,
      processed: result.processed,
      activated: result.activated,
      locked: result.locked,
      durationMs,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
