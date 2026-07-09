/**
 * POST /api/team/submit
 *
 * Endpoint for a participant_leader to submit their team profile.
 *
 * Expected payload:
 * {
 *   teamName: string,
 *   college: string,        // Leader's college (team-level)
 *   department: string,
 *   year: string,
 *   state: string,
 *   city: string,
 *   leaderName: string,
 *   leaderPhone: string,    // 10 digits — +91 prefix added server-side
 *   leaderGithub: string | null,
 *   leaderLinkedin: string | null,
 *   track: string,
 *   problemStatement: string,
 *   isCustomPS: boolean,
 *   members: [
 *     { name, email, phone, role, college, github }  // 2–4 total (leader at [0])
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
  name: z.string().min(1, 'Member name is required'),
  email: z.string().email('Valid member email is required'),
  phone: z.string().min(1, 'Member phone is required'),
  role: z.string().min(1, 'Member role is required'),
  college: z.string().min(1, 'Member college is required'),
  github: z.string().nullable().optional().default(null),
});

const submitSchema = z.object({
  teamName: z.string().min(1, 'Team name is required'),
  college: z.string().min(1, 'College is required'),
  department: z.string().default(''),
  year: z.string().default(''),
  state: z.string().default(''),
  city: z.string().default(''),
  leaderName: z.string().min(1, 'Leader name is required'),
  leaderPhone: z.string().min(1, 'Leader phone is required'),
  leaderGithub: z.string().nullable().optional().default(null),
  leaderLinkedin: z.string().nullable().optional().default(null),
  track: z.string().min(1, 'Track selection is required'),
  problemStatement: z.string().min(10, 'Problem statement must be at least 10 characters'),
  isCustomPS: z.boolean().default(false),
  // 2–4 members total (leader included at index 0)
  members: z
    .array(memberSchema)
    .min(2, 'At least 2 members are required (including leader)')
    .max(4, 'Maximum 4 members allowed (including leader)'),
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

    const input = parsed.data as TeamProfileInput;

    // 3. Fetch User Doc to get the invitedTeamId
    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(token.uid).get();

    if (!userSnap.exists) {
      throw Errors.unauthorized('User not found.');
    }

    const userData = userSnap.data()!;
    const invitedTeamId = userData['invitedTeamId'] as string;

    // 4. Submit to service (phone validation + duplicate checks happen inside)
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
