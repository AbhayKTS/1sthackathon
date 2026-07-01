/**
 * PATCH /api/team/update
 * Updates a team's details, provided it's in a draft or incomplete state.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { updateTeamDetails } from '@/server/services/team.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    const body = await request.json();

    await updateTeamDetails(token.uid, body);

    const response = apiSuccess({ message: 'Team profile updated successfully and submitted for review.' });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
