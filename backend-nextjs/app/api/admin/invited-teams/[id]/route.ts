/**
 * PATCH /api/admin/invited-teams/[id] — edit a draft team
 * POST  /api/admin/invited-teams/[id]/invite — send leader invitation
 * GET   /api/admin/invited-teams/[id] — get single invited team
 *
 * @route /api/admin/invited-teams/[id]
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { editDraftTeam, sendLeaderInvitation } from '@/server/services/invitation.service';
import { getAdminDb } from '@/lib/firebase-admin';

type Params = { params: Promise<{ id: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection('invitedTeams').doc(id).get();

    if (!snap.exists) throw Errors.notFound('Invited team');

    const response = apiSuccess({ id: snap.id, ...snap.data() });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { id } = await params;
    const body = await request.json();

    await editDraftTeam(token.uid, id, {
      teamName: body.teamName,
      leaderName: body.leaderName,
      leaderPhone: body.leaderPhone,
      college: body.college,
      domain: body.domain,
      problemStatement: body.problemStatement,
      isCustomPS: body.isCustomPS,
      members: body.members,
    });

    const response = apiSuccess({ updated: true });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
