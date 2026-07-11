/**
 * POST /api/admin/invited-teams/[id]/invite
 * Sends the leader invitation email for a Draft team.
 *
 * @route POST /api/admin/invited-teams/[id]/invite
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { sendLeaderInvitation } from '@/server/services/invitation.service';

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
    const jobId = await sendLeaderInvitation(token.uid, id);

    const response = apiSuccess({ queued: true, mailJobId: jobId });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
