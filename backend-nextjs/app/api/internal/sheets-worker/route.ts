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

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const cronSecret = request.headers.get('X-Cron-Secret') ?? request.headers.get('x-cron-secret');

    if (!env.CRON_SECRET || cronSecret !== env.CRON_SECRET) {
      throw Errors.unauthorized('Invalid or missing X-Cron-Secret.');
    }

    if (await isSheetsSyncLocked()) {
      const response = apiSuccess({ ok: false, message: 'Synchronization in progress.' });
      return applyCorsHeaders(response, origin);
    }

    const result = await processSheetsQueue();
    const response = apiSuccess({ ok: true, result });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
