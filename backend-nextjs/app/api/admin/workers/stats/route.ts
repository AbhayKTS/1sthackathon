/**
 * GET /api/admin/workers/stats
 *
 * Secure endpoint for admins to retrieve current statuses and performance metrics
 * of all three background queue workers (mail, sheets, scheduler).
 * Requires admin or super_admin role.
 *
 * @route GET /api/admin/workers/stats
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getWorkerStats } from '@/server/services/worker-stats.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    // 1. Authenticate and authorize (admin or super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    // 2. Fetch tracking stats for all three workers
    const [mail, sheets, scheduler] = await Promise.all([
      getWorkerStats('mail'),
      getWorkerStats('sheets'),
      getWorkerStats('scheduler'),
    ]);

    const response = apiSuccess({
      mail,
      sheets,
      scheduler,
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
