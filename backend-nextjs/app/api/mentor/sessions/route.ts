/**
 * GET /api/mentor/sessions — Fetches sessions assigned to the current mentor.
 *
 * @route GET /api/mentor/sessions
 * @auth  Mentor only
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['mentor']);

    const db = getAdminDb();
    const snap = await db
      .collection('sessions')
      .where('hostUid', '==', token.uid)
      .get();

    const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const response = apiSuccess({ sessions });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
