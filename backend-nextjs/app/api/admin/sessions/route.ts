/**
 * POST /api/admin/sessions — assign a mentor/judge session to a team
 * GET  /api/admin/sessions?roundId=... — list all sessions for a round (admin)
 *
 * Session docs: one per team per round (composite ID: teamId_roundId)
 * Firestore security rules: participants can only read their own team's sessions.
 *
 * @route /api/admin/sessions
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { assignSession } from '@/server/services/round.service';
import { getAdminDb } from '@/lib/firebase-admin';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

/** GET /api/admin/sessions?roundId=round-1 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { searchParams } = new URL(request.url);
    const roundId = searchParams.get('roundId');

    const db = getAdminDb();
    let q = db.collection('sessions').limit(200);
    if (roundId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      q = (db.collection('sessions').where('roundId', '==', roundId) as any).limit(200);
    }

    const snap = await (q as ReturnType<typeof db.collection>).get();
    const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const response = apiSuccess({ sessions }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

const sessionSchema = z.object({
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  meetingLink: z.string().url('Meeting link must be a valid URL'),
  slotStart: z.string().min(1, 'Slot start time is required'),
  slotEnd: z.string().min(1, 'Slot end time is required'),
  type: z.enum(['mentor', 'judge']),
});

/** POST /api/admin/sessions */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = sessionSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const sessionId = await assignSession(token.uid, parsed.data);

    const response = apiSuccess({ sessionId, message: 'Session assigned.' }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
