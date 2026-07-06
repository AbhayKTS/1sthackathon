/**
 * POST /api/admin/invite-team
 *
 * Secure endpoint for manually inviting a single shortlisted team.
 * Requires `admin` or `super_admin` role.
 *
 * Expected payload: JSON
 * {
 *   teamName, leaderName, leaderEmail, leaderPhone, college
 * }
 *
 * Returns: { success: true, message: string }
 *
 * @route POST /api/admin/invite-team
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { importInvitations, type CsvRow } from '@/server/services/invitation.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const schema = z.object({
  teamName: z.string().min(1, 'Team name is required'),
  leaderName: z.string().min(1, 'Leader name is required'),
  leaderEmail: z.string().email('Valid email is required'),
  leaderPhone: z.string().min(1, 'Phone is required'),
  college: z.string().min(1, 'College is required'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Auth & Role check (admin or super_admin)
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    // 2. Parse JSON
    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const record: CsvRow = parsed.data;

    // Generate a unique batch ID for this manual invite
    const batchId = `manual_${randomUUID()}`;

    // 3. Pass to service for insertion
    const result = await importInvitations([record], token.uid, token.role, batchId);

    if (result.failed > 0) {
      throw Errors.internal('Failed to invite team (already exists or database error).');
    }

    if (result.skipped > 0) {
      throw Errors.validation('Team or Email already exists in the invited teams list.');
    }

    // 4. Return success
    const response = apiSuccess(
      {
        message: 'Team successfully invited.',
        stats: result,
      },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
