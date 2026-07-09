/**
 * PATCH /api/admin/rounds/[roundId]  — update a round's fields
 * GET   /api/admin/rounds             — list all rounds
 *
 * isActive and isLocked are independently settable.
 * No hardcoded list of round IDs — any roundId is accepted.
 *
 * @route /api/admin/rounds
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { updateRound, listRounds, ensureRoundExists, type UpdateRoundInput } from '@/server/services/round.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

/** GET /api/admin/rounds — list all rounds */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const rounds = await listRounds();
    const response = apiSuccess({ rounds }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

const updateSchema = z.object({
  roundId: z.string().min(1, 'Round ID is required'),
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['ppt', 'mentoring_prototype', 'timeleap', 'judges_final', 'general']).optional(),
  isActive: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  submissionDeadline: z.string().nullable().optional(),
  googleSheetId: z.string().nullable().optional(),
  // If true and round doc doesn't exist, create it with defaults first
  createIfMissing: z.boolean().optional().default(false),
});

/** PATCH /api/admin/rounds — update any field(s) on a round */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { roundId, createIfMissing, ...fields } = parsed.data;

    if (createIfMissing) {
      await ensureRoundExists(token.uid, roundId, fields as UpdateRoundInput);
    }

    const input: UpdateRoundInput = fields as UpdateRoundInput;
    await updateRound(token.uid, roundId, input);

    const response = apiSuccess({ message: `Round "${roundId}" updated.` }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
