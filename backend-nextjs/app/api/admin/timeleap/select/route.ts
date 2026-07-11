/**
 * POST /api/admin/timeleap/select
 * Admin sets Time Leap eligibility or qualification for teams.
 *
 * Body:
 *   teamIds: string[]
 *   eligible: boolean
 *
 * @route POST /api/admin/timeleap/select
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { bulkSetTimeLeapEligible } from '@/server/services/admin.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    const teamIds = body.teamIds;
    const eligible = !!body.eligible;

    if (!Array.isArray(teamIds) || teamIds.length === 0) {
      throw Errors.validation('teamIds must be a non-empty array of strings.');
    }

    await bulkSetTimeLeapEligible(token.uid, teamIds, eligible);

    const response = apiSuccess({ ok: true, count: teamIds.length, eligible });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
