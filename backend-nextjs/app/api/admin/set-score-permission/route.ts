/**
 * PATCH /api/admin/set-score-permission
 *
 * super_admin only endpoint to grant or revoke canEditScores on an admin user.
 *
 * Body: { targetUid: string, canEditScores: boolean }
 *
 * @route PATCH /api/admin/set-score-permission
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '@/server/services/audit.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const schema = z.object({
  targetUid: z.string().min(1, 'Target UID is required'),
  canEditScores: z.boolean(),
});

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { targetUid, canEditScores } = parsed.data;
    const db = getAdminDb();

    const targetSnap = await db.collection('users').doc(targetUid).get();
    if (!targetSnap.exists) {
      throw Errors.notFound('Target user not found.');
    }

    const targetRole = targetSnap.data()?.role;
    if (targetRole !== 'admin') {
      throw Errors.validation('canEditScores can only be set on users with role "admin".');
    }

    await db.collection('users').doc(targetUid).update({
      canEditScores,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      action: 'admin.score_permission_changed',
      actorUid: token.uid,
      actorRole: 'super_admin',
      targetId: targetUid,
      targetType: 'users',
      metadata: { canEditScores },
      ip: null,
    });

    return applyCorsHeaders(
      apiSuccess({ message: `canEditScores set to ${canEditScores} for user ${targetUid}.` }, 200),
      origin
    );
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
