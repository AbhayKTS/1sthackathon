/**
 * GET /api/leaderboard/[roundId] — public leaderboard
 * Returns standings only if the round's leaderboard is published.
 *
 * @route GET /api/leaderboard/[roundId]
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { getPublishedLeaderboard } from '@/server/services/evaluation.service';

type Params = { params: Promise<{ roundId: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    await withAuth(request);  // Must be logged in to view leaderboard

    const { roundId } = await params;
    const result = await getPublishedLeaderboard(roundId);

    const response = apiSuccess({ roundId, ...result });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
