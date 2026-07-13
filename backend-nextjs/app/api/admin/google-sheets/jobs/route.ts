/**
 * GET /api/admin/google-sheets/jobs
 *
 * Secure endpoint for admins to list Google Sheets synchronization jobs.
 * Requires admin or super_admin role.
 *
 * @route GET /api/admin/google-sheets/jobs
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { listSyncJobs } from '@/server/services/sheets-queue.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    // 1. Authenticate and authorize (admin or super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    // 2. Retrieve jobs using the existing service function
    const jobs = await listSyncJobs({ limit });

    const response = apiSuccess({ jobs });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
