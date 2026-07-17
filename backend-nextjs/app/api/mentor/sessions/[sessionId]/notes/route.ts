/**
 * PATCH /api/mentor/sessions/[sessionId]/notes — Mentor updates session notes.
 *
 * @route PATCH /api/mentor/sessions/[sessionId]/notes
 * @auth  Mentor only
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { FieldValue } from 'firebase-admin/firestore';

type Params = { params: Promise<{ sessionId: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['mentor']);

    const { sessionId } = await params;
    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    const notes = body.notes ?? '';

    const db = getAdminDb();
    const sessionRef = db.collection('sessions').doc(sessionId);
    const snap = await sessionRef.get();

    if (!snap.exists) {
      throw Errors.notFound('Session not found.');
    }

    const sessionData = snap.data()!;
    if (sessionData.hostUid !== token.uid) {
      throw Errors.forbidden('You are not authorized to update notes for this session.');
    }

    await sessionRef.update({
      notes,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: token.uid,
    });

    const response = apiSuccess({ updated: true });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
