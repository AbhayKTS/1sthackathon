/**
 * PATCH /api/admin/permissions/[userId] — update a user's permissions
 *
 * @route PATCH /api/admin/permissions/[userId]
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { updatePermissions } from '@/server/services/permissions.service';
import type { UserRole } from '@/types/index';

type Params = { params: Promise<{ userId: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const { userId } = await params;
    const body = await request.json();

    await updatePermissions(token.uid, userId, {
      ...(body.role !== undefined && { role: body.role as UserRole }),
      ...(body.canEditScores !== undefined && { canEditScores: body.canEditScores }),
      ...(body.canPublishScores !== undefined && { canPublishScores: body.canPublishScores }),
      ...(body.canManageRounds !== undefined && { canManageRounds: body.canManageRounds }),
      ...(body.canManageTeams !== undefined && { canManageTeams: body.canManageTeams }),
      ...(body.canSendEmails !== undefined && { canSendEmails: body.canSendEmails }),
      ...(body.canViewLogs !== undefined && { canViewLogs: body.canViewLogs }),
    });

    const response = apiSuccess({ updated: true });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
