/**
 * POST /api/admin/evaluations/publish
 * Publishes all draft scores for a round. super_admin only.
 *
 * Body: { roundId: string }
 *
 * @route POST /api/admin/evaluations/publish
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { publishRoundScores } from '@/server/services/evaluation.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    if (!body.roundId) throw Errors.validation('roundId is required.');

    const result = await publishRoundScores(token, { roundId: body.roundId });

    const response = apiSuccess({ ...result, roundId: body.roundId });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
