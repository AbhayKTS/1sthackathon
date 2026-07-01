/**
 * POST /api/submission/submit
 *
 * Endpoint for a team to submit their payload for a specific round.
 *
 * Expected payload:
 * {
 *   teamId: string,
 *   roundId: string,
 *   githubLink: string,
 *   demoLink?: string
 * }
 *
 * @route POST /api/submission/submit
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { submitPayload, type SubmitPayloadInput } from '@/server/services/submission.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const submissionSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  roundId: z.string().min(1, 'Round ID is required'),
  githubLink: z.string().url('Must be a valid URL'),
  demoLink: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    // Note: Any authenticated user can hit this; the service layer checks if they are authorized for the team.

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = submissionSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const input: SubmitPayloadInput = {
      teamId: parsed.data.teamId,
      roundId: parsed.data.roundId,
      githubLink: parsed.data.githubLink,
    };
    if (parsed.data.demoLink) {
        input.demoLink = parsed.data.demoLink;
    }

    await submitPayload(token.uid, input);

    const response = apiSuccess(
      { message: `Submission successful` },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
