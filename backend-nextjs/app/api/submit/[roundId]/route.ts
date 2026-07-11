/**
 * POST /api/submit/[roundId]
 * Participant team leader submits round payload.
 *
 * @route POST /api/submit/[roundId]
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth, requireRole } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { submitPayload } from '@/server/services/submission.service';

type Params = { params: Promise<{ roundId: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['participant_leader']);

    const { roundId } = await params;
    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    if (!body.teamId) throw Errors.validation('teamId is required.');

    await submitPayload(token.uid, {
      teamId: body.teamId,
      roundId,
      githubLink: body.githubLink,
      demoLink: body.demoLink,
      pptLink: body.pptLink,
      prototypeLink: body.prototypeLink,
      hasNoPrototype: body.hasNoPrototype,
    });

    const response = apiSuccess({ submitted: true, roundId });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
