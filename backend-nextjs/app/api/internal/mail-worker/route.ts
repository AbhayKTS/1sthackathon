/**
 * POST /api/internal/mail-worker
 * Processes the mail queue. Secured with CRON_SECRET header.
 *
 * Called by:
 *   - Vercel Cron (if on paid plan)
 *   - Manual trigger from admin panel "Process Queue" button
 *
 * Security: X-Cron-Secret header must match CRON_SECRET env var.
 * If CRON_SECRET is not set, only super_admin token auth is accepted.
 *
 * @route POST /api/internal/mail-worker
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { env } from '@/lib/env';
import { processMailQueue } from '@/server/services/mail-queue.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    // Authenticate: either CRON_SECRET header OR a valid super_admin token
    const cronSecret = request.headers.get('X-Cron-Secret') ?? request.headers.get('x-cron-secret');

    if (env.CRON_SECRET) {
      if (cronSecret !== env.CRON_SECRET) {
        // Fall back to checking admin auth
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          throw Errors.unauthorized('Missing X-Cron-Secret header or Bearer token.');
        }
        // Verify token is super_admin
        const { withAuth, requireRole } = await import('@/lib/api-helpers');
        const token = await withAuth(request);
        requireRole(token, ['super_admin']);
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw Errors.unauthorized('CRON_SECRET not configured. Cannot allow unauthenticated cron calls.');
    }

    const result = await processMailQueue();
    const response = apiSuccess({ ok: true, result });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
