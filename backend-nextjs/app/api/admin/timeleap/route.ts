/**
 * PATCH /api/admin/timeleap
 *
 * Sets isTimeLeapSelected and/or isTop10/isTop15 flags on a team.
 * super_admin only (audit logged).
 *
 * Body: { teamId, isTimeLeapSelected?, isTop10?, isTop15? }
 *
 * @route PATCH /api/admin/timeleap
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { setTimeLeapSelected, setTopFlags } from '@/server/services/team.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const schema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  isTimeLeapSelected: z.boolean().optional(),
  isTop10: z.boolean().optional(),
  isTop15: z.boolean().optional(),
});

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { teamId, isTimeLeapSelected, isTop10, isTop15 } = parsed.data;

    if (isTimeLeapSelected !== undefined) {
      await setTimeLeapSelected(token.uid, teamId, isTimeLeapSelected);
    }

    if (isTop10 !== undefined || isTop15 !== undefined) {
      await setTopFlags(token.uid, teamId, {
        ...(isTop10 !== undefined && { isTop10 }),
        ...(isTop15 !== undefined && { isTop15 }),
      });
    }

    const response = apiSuccess({ message: 'Team flags updated.' }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
