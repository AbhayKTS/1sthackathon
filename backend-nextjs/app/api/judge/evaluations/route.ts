/**
 * POST /api/judge/evaluations — Judge submits a score
 *
 * @route /api/judge/evaluations
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { enterDraftScore } from '@/server/services/evaluation.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['judge']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    if (!body.teamId) throw Errors.validation('teamId is required.');
    if (!body.roundId) throw Errors.validation('roundId is required.');
    if (body.draftScore === undefined || body.draftScore === null) {
      throw Errors.validation('draftScore is required.');
    }

    const score = parseFloat(body.draftScore);
    if (isNaN(score) || score < 0 || score > 100) {
      throw Errors.validation('draftScore must be a number between 0 and 100.');
    }

    await enterDraftScore(token, {
      teamId: body.teamId,
      roundId: body.roundId,
      draftScore: score,
      feedback: body.feedback,
      judgeUid: token.uid, // Enforce current user as judge
    });

    const response = apiSuccess({ saved: true });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
