/**
 * GET /api/admin/teams
 *
 * List all registered teams. Requires admin or super_admin role.
 * Returns team documents with id, teamName, leaderName, trackId, leader, members, etc.
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
    requireRole(token, ['admin', 'super_admin']);

    const db = getAdminDb();
    const snap = await db.collection('teams').get();

    const teams = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        teamName: d.teamName ?? '',
        leaderName: d.leaderName ?? '',
        leaderUid: d.leaderUid ?? null,
        trackId: d.trackId ?? null,
        problemStatement: d.problemStatement ?? '',
        status: d.status ?? 'pending',
        leader: d.leader ?? null,
        members: d.members ?? [],
        assignedJudgeUids: d.assignedJudgeUids ?? [],
        assignedMentorUids: d.assignedMentorUids ?? [],
        isTimeleapEligible: d.isTimeleapEligible ?? false,
        isFinalist: d.isFinalist ?? false,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
      };
    });

    // Return both shapes: `data` for Users tab, `teams` for Sessions tab
    const response = apiSuccess({ data: teams, teams }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
