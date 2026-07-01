/**
 * PATCH /api/admin/review-team
 *
 * Endpoint for an admin to approve, reject, or request changes on a team profile.
 *
 * Expected payload:
 * {
 *   teamId: string,
 *   action: 'approve' | 'reject' | 'needChanges',
 *   notes?: string,
 *   lastUpdatedAt: number
 * }
 *
 * @route PATCH /api/admin/review-team
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { reviewTeam, type ReviewTeamInput } from '@/server/services/admin.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const reviewSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  action: z.enum(['approve', 'reject', 'needChanges']),
  notes: z.string().optional(),
  lastUpdatedAt: z.number(),
});

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Auth & Role check (admin or super_admin allowed)
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    // 2. Parse payload
    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const input = parsed.data as ReviewTeamInput;

    // 3. Perform Review
    await reviewTeam(token.uid, input);

    const response = apiSuccess(
      { message: `Team successfully marked as ${input.action}` },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
