/**
 * GET /api/timeleap/status
 * Returns whether the authenticated participant's team is eligible for Time Leap.
 *
 * @route GET /api/timeleap/status
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth, requireRole } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';

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
      const response = apiSuccess({ eligible: false, qualified: false, teamId: null });
      return applyCorsHeaders(response, origin);
    }

    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (!teamSnap.exists) {
      const response = apiSuccess({ eligible: false, qualified: false, teamId });
      return applyCorsHeaders(response, origin);
    }

    const teamData = teamSnap.data()!;

    const response = apiSuccess({
      eligible: teamData['isTimeLeapEligible'] ?? false,
      qualified: teamData['isTimeLeapQualified'] ?? false,
      isFinalist: teamData['isFinalist'] ?? false,
      teamId,
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
