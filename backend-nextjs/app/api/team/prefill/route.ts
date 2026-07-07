/**
 * GET /api/team/prefill
 *
 * Returns the invited team data for the currently logged in participant_leader
 * so the onboarding form can pre-fill the leader's name, phone, and team name.
 *
 * @route GET /api/team/prefill
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    // Allow participant_leader to prefill (participant_member has a team already)
    requireRole(token, ['participant_leader']);

    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(token.uid).get();

    if (!userSnap.exists) {
      return applyCorsHeaders(apiSuccess({ prefill: null }, 200), origin);
    }

    const userData = userSnap.data()!;
    const invitedTeamId = userData['invitedTeamId'] as string | null;

    if (!invitedTeamId) {
      return applyCorsHeaders(apiSuccess({ prefill: null }, 200), origin);
    }

    const inviteSnap = await db.collection('invitedTeams').doc(invitedTeamId).get();

    if (!inviteSnap.exists) {
      return applyCorsHeaders(apiSuccess({ prefill: null }, 200), origin);
    }

    const inviteData = inviteSnap.data()!;

    // Return only the safe fields needed for pre-filling
    const prefill = {
      teamName: inviteData['teamName'] || '',
      leaderName: inviteData['leaderName'] || '',
      leaderPhone: inviteData['leaderPhone'] || '',
      college: inviteData['college'] || '',
    };

    const response = apiSuccess({ prefill }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
