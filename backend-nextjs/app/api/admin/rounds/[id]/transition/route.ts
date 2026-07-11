/**
 * POST /api/admin/rounds/[id]/transition
 * Transitions a round to a new status in the state machine.
 *
 * Body: { to: RoundStatus }
 *
 * @route POST /api/admin/rounds/[id]/transition
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { transitionRound } from '@/server/services/round-state.service';
import type { RoundStatus } from '@/types/index';

const VALID_STATUSES: RoundStatus[] = ['Draft', 'Published', 'Active', 'Locked', 'Evaluation', 'Completed', 'Archived'];

type Params = { params: Promise<{ id: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { id } = await params;

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    const to = body.to as RoundStatus;
    if (!to || !VALID_STATUSES.includes(to)) {
      throw Errors.validation(`Invalid target status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    await transitionRound(token.uid, id, to, token.role === 'super_admin');

    const response = apiSuccess({ transitioned: true, roundId: id, to });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
