/**
 * POST /api/admin/sessions/bulk-assign
 * 
 * @route /api/admin/sessions/bulk-assign
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { bulkAssignSessions } from '@/server/services/session.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    if (!body.teamIds || !Array.isArray(body.teamIds) || body.teamIds.length === 0) {
      throw Errors.validation('teamIds array is required and must not be empty.');
    }
    if (!body.roundId) throw Errors.validation('roundId is required.');
    if (!body.startTime) throw Errors.validation('startTime is required.');
    
    const slotDurationMinutes = parseInt(body.slotDurationMinutes, 10);
    if (isNaN(slotDurationMinutes) || slotDurationMinutes <= 0) {
      throw Errors.validation('slotDurationMinutes must be a positive integer.');
    }

    await bulkAssignSessions(token, {
      teamIds: body.teamIds,
      judgeUid: body.judgeUid,
      mentorUid: body.mentorUid,
      meetLink: body.meetLink,
      roundId: body.roundId,
      startTime: body.startTime,
      slotDurationMinutes
    });

    const response = apiSuccess({ assigned: true, count: body.teamIds.length });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    // If it's a conflict error, it will automatically serialize as 409
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
