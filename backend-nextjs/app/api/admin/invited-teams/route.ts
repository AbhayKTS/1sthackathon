/**
 * GET  /api/admin/invited-teams — list invited teams (with filters)
 *
 * Query params:
 *   status    — filter by status (comma-separated)
 *   batchId   — filter by import batch
 *   limit     — pagination (default 50)
 *   startAfter — cursor for pagination
 *
 * @route GET /api/admin/invited-teams
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { listInvitedTeams } from '@/server/services/invitation.service';
import { bulkSendInvitations } from '@/server/services/invitation.service';
import type { InvitedTeamStatus } from '@/types/index';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const batchId = url.searchParams.get('batchId') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const startAfter = url.searchParams.get('startAfter') ?? undefined;

    const status = statusParam
      ? (statusParam.split(',') as InvitedTeamStatus[])
      : undefined;

    const result = await listInvitedTeams({
      ...(status && { status }),
      ...(batchId && { batchId }),
      limit,
      ...(startAfter && { startAfter }),
    });
    const response = apiSuccess(result);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

/**
 * POST /api/admin/invited-teams
 * Bulk send invitations to multiple Draft teams.
 * Body: { teamIds: string[] }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json();
    const teamIds: string[] = body.teamIds;

    if (!Array.isArray(teamIds) || teamIds.length === 0) {
      const response = apiSuccess({ queued: 0, skipped: 0, errors: [] });
      return applyCorsHeaders(response, origin);
    }

    const result = await bulkSendInvitations(token.uid, teamIds);
    const response = apiSuccess(result);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
