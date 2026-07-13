/**
 * POST /api/internal/sheets-worker
 * Processes the Google Sheets sync queue. Secured with CRON_SECRET.
 *
 * @route POST /api/internal/sheets-worker
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { env } from '@/lib/env';
import { isSheetsSyncLocked, processSheetsQueue } from '@/server/services/sheets-queue.service';
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

    if (await isSheetsSyncLocked()) {
      const response = apiSuccess({ ok: false, message: 'Synchronization in progress.' });
      return applyCorsHeaders(response, origin);
    }

    // 2. Track worker execution state
    await setWorkerStatus('sheets', 'PROCESSING');

    try {
      const result = await processSheetsQueue();
      await setWorkerResult('sheets', result.processed, result.failed, null);

      const response = apiSuccess({ ok: true, result });
      return applyCorsHeaders(response, origin);
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await setWorkerResult('sheets', 0, 1, errorMsg);
      throw err;
    }
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
