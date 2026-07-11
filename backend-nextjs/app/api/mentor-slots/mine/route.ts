/**
 * GET /api/mentor-slots/mine
 * Participant gets their team's mentor slots.
 *
 * Query params:
 *   roundId — optional filter by round
 *
 * @route GET /api/mentor-slots/mine
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth, requireRole } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb } from '@/lib/firebase-admin';
import { getTeamMentorSlot, getTeamAllSlots } from '@/server/services/mentor-slot.service';

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

    const url = new URL(request.url);
    const roundId = url.searchParams.get('roundId');

    if (roundId) {
      const slot = await getTeamMentorSlot(teamId, roundId, false);
      const response = apiSuccess({ slots: slot ? [slot] : [] });
      return applyCorsHeaders(response, origin);
    } else {
      const slots = await getTeamAllSlots(teamId, false);
      const response = apiSuccess({ slots });
      return applyCorsHeaders(response, origin);
    }
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
