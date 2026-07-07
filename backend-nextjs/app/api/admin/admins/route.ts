/**
 * GET /api/admin/admins
 * DELETE /api/admin/admins
 *
 * Manage administrators. Only accessible by super_admin.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { writeAuditLog } from '@/server/services/audit.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const db = getAdminDb();
    const snap = await db.collection('users').where('role', 'in', ['admin', 'super_admin']).get();
    
    const admins = snap.docs.map(doc => {
        const data = doc.data();
        return {
            uid: doc.id,
            email: data.email,
            role: data.role,
        };
    });

    const response = apiSuccess({ admins }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}

const deleteSchema = z.object({
  uid: z.string().min(1, 'UID is required'),
});

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { uid } = parsed.data;

    if (uid === token.uid) {
        throw Errors.validation('You cannot remove yourself.');
    }

    const db = getAdminDb();
    const adminAuth = getAdminAuth();

    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();
    
    if (!userDoc.exists) {
        throw Errors.notFound('User not found');
    }
    
    if (userDoc.data()?.role === 'super_admin') {
        throw Errors.validation('Cannot remove a super_admin.');
    }

    // Demote user to participant_member or just remove the role
    await userDocRef.update({ role: 'participant_member' });

    // Optionally revoke refresh tokens
    await adminAuth.revokeRefreshTokens(uid);

    await writeAuditLog({
      action: 'admin.removed',
      actorUid: token.uid,
      actorRole: 'super_admin',
      targetId: uid,
      targetType: 'users',
      metadata: { email: userDoc.data()?.email },
      ip: null,
    });

    const response = apiSuccess({ message: 'Admin successfully removed.' }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
