/**
 * POST /api/internal/scheduler-worker — System-level timeline automation cron.
 *
 * Runs automatically (via GitHub Actions or script) to transition rounds based on start dates
 * and deadlines, and publishes notifications/announcements dynamically.
 * Protected by CRON_SECRET authentication.
 *
 * @route POST /api/internal/scheduler-worker
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions } from '@/lib/api-helpers';
import { env } from '@/lib/env';
import { Errors } from '@/lib/errors';
import { runSchedulerWorker } from '@/server/services/scheduler-worker.service';
import { setWorkerStatus, setWorkerResult } from '@/server/services/worker-stats.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Authenticate using X-Cron-Secret header or Bearer Token
    const cronSecret = request.headers.get('X-Cron-Secret') ?? request.headers.get('x-cron-secret');
    const authHeader = request.headers.get('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const secretToVerify = cronSecret || bearerToken;

    if (!env.CRON_SECRET || secretToVerify !== env.CRON_SECRET) {
      throw Errors.unauthorized('Invalid or missing CRON_SECRET.');
    }

    // 2. Track worker execution state
    await setWorkerStatus('scheduler', 'PROCESSING');

    try {
      // 3. Process scheduler events
      const result = await runSchedulerWorker();
      await setWorkerResult('scheduler', result.processed, 0, null);

      const response = apiSuccess({ ok: true, result });
      return applyCorsHeaders(response, origin);
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await setWorkerResult('scheduler', 0, 1, errorMsg);
      throw err;
    }
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
