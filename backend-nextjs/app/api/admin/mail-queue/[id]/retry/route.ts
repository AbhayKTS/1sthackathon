/**
 * POST /api/admin/mail-queue/[id]/retry
 * Manually retries a failed mail job.
 *
 * @route POST /api/admin/mail-queue/[id]/retry
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { retryMailJob } from '@/server/services/mail-queue.service';

type Params = { params: Promise<{ id: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { id } = await params;
    await retryMailJob(id, token.uid);

    const response = apiSuccess({ retried: true, jobId: id });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
