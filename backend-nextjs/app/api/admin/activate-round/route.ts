/**
 * POST /api/admin/activate-round
 *
 * Endpoint for an admin to activate a round (and deactivate all others).
 *
 * Expected payload:
 * {
 *   roundId: string,
 *   roundTitle: string,
 *   roundDesc: string
 * }
 *
 * @route POST /api/admin/activate-round
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { activateRound } from '@/server/services/admin.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const activateSchema = z.object({
  roundId: z.string().min(1, 'Round ID is required'),
  roundTitle: z.string().min(1, 'Round Title is required'),
  roundDesc: z.string().min(1, 'Round Description is required'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = activateSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { roundId, roundTitle, roundDesc } = parsed.data;

    await activateRound(token.uid, roundId, roundTitle, roundDesc);

    const response = apiSuccess(
      { message: `Round successfully activated` },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
