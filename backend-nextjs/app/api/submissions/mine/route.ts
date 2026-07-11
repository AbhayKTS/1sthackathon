/**
 * GET /api/submissions/mine
 * Participant views their own team's submissions.
 *
 * @route GET /api/submissions/mine
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth, requireRole } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb } from '@/lib/firebase-admin';
import { getTeamSubmissions } from '@/server/services/submission.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['participant_leader', 'participant_member']);

    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(token.uid).get();
    const teamId = userSnap.data()?.teamId as string | null;

    if (!teamId) {
      throw Errors.validation('User is not associated with any team.');
    }

    const submissions = await getTeamSubmissions(teamId);
    const response = apiSuccess({ submissions });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
