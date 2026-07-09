/**
 * POST /api/submission/submit
 *
 * Endpoint for a team leader to submit their payload for a specific round.
 * The accepted fields depend on the round's `type` field — the service layer
 * enforces the correct fields per round type.
 *
 * Expected payload:
 * {
 *   teamId: string,
 *   roundId: string,
 *   // One of the following sets, matching the round type:
 *   githubLink?: string,        // for 'general' rounds
 *   demoLink?: string,          // for 'general' rounds (optional)
 *   pptLink?: string,           // for 'ppt' rounds
 *   prototypeLink?: string,     // for 'mentoring_prototype' rounds
 *   hasNoPrototype?: boolean,   // for 'mentoring_prototype' rounds (no link yet)
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

// Accept all possible fields — the service layer validates which are required
// based on the round type fetched from Firestore. This keeps the route thin.
const submissionSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  roundId: z.string().min(1, 'Round ID is required'),
  // General / legacy
  githubLink: z.string().url().optional(),
  demoLink: z.string().url().optional().or(z.literal('')),
  // PPT round
  pptLink: z.string().url().optional(),
  // Mentoring/prototype round
  prototypeLink: z.string().url().optional(),
  hasNoPrototype: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    // Service layer checks if caller is the team leader

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
      ...(parsed.data.githubLink !== undefined && { githubLink: parsed.data.githubLink }),
      ...(parsed.data.demoLink ? { demoLink: parsed.data.demoLink } : {}),
      ...(parsed.data.pptLink !== undefined && { pptLink: parsed.data.pptLink }),
      ...(parsed.data.prototypeLink !== undefined && { prototypeLink: parsed.data.prototypeLink }),
      ...(parsed.data.hasNoPrototype !== undefined && { hasNoPrototype: parsed.data.hasNoPrototype }),
    };

    await submitPayload(token.uid, input);

    const response = apiSuccess(
      { message: 'Submission received. Your payload has been transmitted.' },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
