/**
 * GET /api/rounds — public round list (participants)
 * Only returns Published/Active/Locked/Completed rounds visible to the team.
 *
 * @route GET /api/rounds
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { listRounds } from '@/server/services/round-state.service';
import { getAdminDb } from '@/lib/firebase-admin';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    const isAdmin = token.role === 'admin' || token.role === 'super_admin';

    // Find the team for this participant to filter allowedTeams
    let teamId: string | undefined;
    if (!isAdmin) {
      const db = getAdminDb();
      const userSnap = await db.collection('users').doc(token.uid).get();
      teamId = userSnap.data()?.teamId ?? undefined;
    }

    const rounds = await listRounds({
      isAdmin,
      ...(teamId !== undefined && { teamId }),
    });

    // Strip server-side fields from participant responses
    const sanitized = isAdmin
      ? rounds
      : rounds.map((r) => {
          const { updatedBy, googleSheetId, ...safe } = r as Record<string, unknown>;
          void updatedBy; void googleSheetId;
          return safe;
        });

    const response = apiSuccess({ rounds: sanitized });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
