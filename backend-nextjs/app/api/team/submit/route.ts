/**
 * POST /api/team/submit
 *
 * Endpoint for a participant_leader to submit their team profile.
 *
 * Expected payload:
 * {
 *   teamName: string,
 *   college: string,
 *   members: [
 *     { name: string, email: string, phone: string, role: string }
 *   ]
 * }
 *
 * @route POST /api/team/submit
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb } from '@/lib/firebase-admin';
import { submitTeamProfile, type TeamProfileInput } from '@/server/services/team.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const memberSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().min(1, 'Phone is required'),
  role: z.string().min(1, 'Role is required'),
});

const submitSchema = z.object({
  teamName: z.string().min(1, 'Team name is required'),
  college: z.string().min(1, 'College is required'),
  members: z.array(memberSchema).min(2, 'At least 2 members are required').max(5, 'Maximum 5 members allowed'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Auth & Role check
    const token = await withAuth(request);
    requireRole(token, ['participant_leader']);

    // 2. Parse payload
    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const input: TeamProfileInput = parsed.data;

    // 3. Fetch User Doc to get the invitedTeamId
    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(token.uid).get();
    
    if (!userSnap.exists) {
      throw Errors.unauthorized('User not found.');
    }
    
    const userData = userSnap.data()!;
    const invitedTeamId = userData['invitedTeamId'] as string;
    
    // We expect participant_leaders to have an invitedTeamId, unless they are admins testing it.
    // Allow empty string if it's missing (e.g., admin fallback).
    
    // 4. Submit to service
    const teamId = await submitTeamProfile(token.uid, invitedTeamId || '', input);

    const response = apiSuccess(
      {
        message: 'Team profile submitted successfully.',
        teamId,
      },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
