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
import { processSheetsQueue } from '@/server/services/sheets-queue.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const cronSecret = request.headers.get('X-Cron-Secret') ?? request.headers.get('x-cron-secret');

    if (env.CRON_SECRET) {
      if (cronSecret !== env.CRON_SECRET) {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          throw Errors.unauthorized('Missing X-Cron-Secret header or Bearer token.');
        }
        const { withAuth, requireRole } = await import('@/lib/api-helpers');
        const token = await withAuth(request);
        requireRole(token, ['super_admin']);
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw Errors.unauthorized('CRON_SECRET not configured.');
    }

    const result = await processSheetsQueue();
    const response = apiSuccess({ ok: true, result });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
