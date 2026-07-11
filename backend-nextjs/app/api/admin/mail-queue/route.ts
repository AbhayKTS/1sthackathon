/**
 * GET  /api/admin/mail-queue — list queue jobs with filters
 * @route GET /api/admin/mail-queue
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { listMailJobs } from '@/server/services/mail-queue.service';
import type { MailStatus } from '@/types/index';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const startAfter = url.searchParams.get('startAfter') ?? undefined;

    const status = statusParam
      ? (statusParam.split(',') as MailStatus[])
      : undefined;

    const result = await listMailJobs({
      ...(status && { status }),
      limit,
      ...(startAfter && { startAfter }),
    });
    const response = apiSuccess(result);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
