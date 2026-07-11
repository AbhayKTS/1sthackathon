/**
 * PATCH /api/admin/mentor-slots/[id]
 * Updates a mentor slot.
 *
 * @route PATCH /api/admin/mentor-slots/[id]
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { updateMentorSlot } from '@/server/services/mentor-slot.service';

type Params = { params: Promise<{ id: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { id } = await params;
    const body = await request.json();

    await updateMentorSlot(token.uid, id, {
      mentorName: body.mentorName,
      mentorUid: body.mentorUid,
      scheduledFor: body.scheduledFor,
      durationMins: body.durationMins,
      meetLink: body.meetLink,
      meetLinkVisibleMinutesBefore: body.meetLinkVisibleMinutesBefore,
      status: body.status,
    });

    const response = apiSuccess({ updated: true });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
