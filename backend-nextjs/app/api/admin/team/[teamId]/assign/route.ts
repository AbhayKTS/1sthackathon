/**
 * PATCH /api/admin/team/[teamId]/assign
 *
 * Secure endpoint for assigning judges and mentors to a team.
 * Requires admin or super_admin role.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, handleOptions, requireRole, withAuth, applyCorsHeaders } from '@/lib/api-helpers';
import { assignTeamJudgesMentors } from '@/server/services/team.service';

type Params = { params: Promise<{ teamId: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { teamId } = await params;
    const body = await request.json();
    const { assignedJudgeUids, assignedMentorUids } = body;

    await assignTeamJudgesMentors(token.uid, teamId, {
      assignedJudgeUids,
      assignedMentorUids
    });

    const response = apiSuccess({ success: true, message: 'Assignments updated successfully.' });
    return applyCorsHeaders(response, origin);
  } catch (error: any) {
    return apiError(error, origin);
  }
}
