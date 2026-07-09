/**
 * PATCH /api/admin/leaderboard — upsert team score
 * GET   /api/admin/leaderboard — get full leaderboard
 *
 * @route /api/admin/leaderboard
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { upsertScore, getLeaderboard, type UpsertScoreInput } from '@/server/services/leaderboard.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

/** GET — returns full leaderboard (admin/super_admin only) */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const leaderboard = await getLeaderboard();
    return applyCorsHeaders(apiSuccess({ leaderboard }, 200), origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

const upsertSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  round1Score: z.number().nullable().optional(),
  round2Score: z.number().nullable().optional(),
  timeLeapScore: z.number().nullable().optional(),
  finalScore: z.number().nullable().optional(),
  rank: z.number().int().positive().nullable().optional(),
  isTop10: z.boolean().optional(),
  isTop15: z.boolean().optional(),
});

/** PATCH — upsert score (permission checked inside service: super_admin OR canEditScores admin) */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    // Role check done inside upsertScore() — allows admin+canEditScores too
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    await upsertScore(token, parsed.data as UpsertScoreInput);

    return applyCorsHeaders(apiSuccess({ message: 'Score updated.' }, 200), origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
