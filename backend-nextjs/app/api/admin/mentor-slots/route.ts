/**
 * POST /api/admin/mentor-slots — create a mentor/judge session slot
 * GET  /api/admin/mentor-slots?roundId=... — list all slots for a round
 *
 * @route /api/admin/mentor-slots
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { createMentorSlot, listRoundMentorSlots } from '@/server/services/mentor-slot.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const url = new URL(request.url);
    const roundId = url.searchParams.get('roundId');
    if (!roundId) throw Errors.validation('roundId query parameter is required.');

    const slots = await listRoundMentorSlots(roundId);
    const response = apiSuccess({ slots });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    if (!body.roundId) throw Errors.validation('roundId is required.');
    if (!body.teamId) throw Errors.validation('teamId is required.');
    if (!body.mentorName?.trim()) throw Errors.validation('mentorName is required.');
    if (!body.scheduledFor) throw Errors.validation('scheduledFor is required.');
    if (!body.meetLink?.trim()) throw Errors.validation('meetLink is required.');

    const slotId = await createMentorSlot(token.uid, {
      roundId: body.roundId,
      mentorName: body.mentorName,
      mentorUid: body.mentorUid ?? null,
      teamId: body.teamId,
      scheduledFor: body.scheduledFor,
      durationMins: body.durationMins,
      meetLink: body.meetLink,
      meetLinkVisibleMinutesBefore: body.meetLinkVisibleMinutesBefore,
    });

    const response = apiSuccess({ created: true, slotId }, 201);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
