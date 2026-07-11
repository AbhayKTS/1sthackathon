/**
 * GET  /api/admin/rounds — list all rounds (admin view, all statuses)
 * POST /api/admin/rounds — create a new round (status: Draft)
 * PATCH /api/admin/rounds — update round fields (backward compat)
 *
 * @route /api/admin/rounds
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { createRound, updateRound, listRounds } from '@/server/services/round-state.service';
import type { RoundType, SubmissionType } from '@/types/index';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

/** GET /api/admin/rounds — list all rounds (admin, all statuses) */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const rounds = await listRounds({ isAdmin: true });
    const response = apiSuccess({ rounds });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

/** POST /api/admin/rounds — create a new round in Draft status */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    if (!body.roundId?.trim()) throw Errors.validation('roundId is required.');
    if (!body.title?.trim()) throw Errors.validation('title is required.');
    if (!body.type) throw Errors.validation('type is required.');
    if (!body.submissionType) throw Errors.validation('submissionType is required.');

    const roundId = (body.roundId as string).trim().toLowerCase().replace(/\s+/g, '-');

    await createRound(token.uid, {
      roundId,
      title: body.title.trim(),
      description: body.description?.trim() ?? '',
      type: body.type as RoundType,
      submissionType: body.submissionType as SubmissionType,
    });

    const response = apiSuccess({ created: true, roundId }, 201);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

/** PATCH /api/admin/rounds — update round fields (backward compat wrapper) */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const roundId = body.roundId as string;
    if (!roundId?.trim()) throw Errors.validation('roundId is required in body.');

    const { roundId: _id, ...fields } = body;

    await updateRound(token.uid, roundId, {
      title: fields.title,
      description: fields.description,
      instructions: fields.instructions,
      resources: fields.resources,
      pptViewerLink: fields.pptViewerLink,
      driveLink: fields.driveLink,
      canvaViewerLink: fields.canvaViewerLink,
      type: fields.type as RoundType,
      submissionType: fields.submissionType as SubmissionType,
      allowedTeams: fields.allowedTeams,
      startsAt: fields.startsAt,
      endsAt: fields.endsAt,
      submissionDeadline: fields.submissionDeadline,
      timerDuration: fields.timerDuration,
      googleSheetId: fields.googleSheetId,
      isVisible: fields.isVisible,
    });

    const response = apiSuccess({ message: `Round "${roundId}" updated.` });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
