/**
 * POST /api/admin/create-admin
 *
 * Super-admin-only endpoint to invite a person as a new admin.
 * Creates the Firebase Auth account if it doesn't exist, then
 * upserts a Firestore users doc with role: 'admin'.
 *
 * Body: { email: string }
 *
 * @route POST /api/admin/create-admin
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '@/server/services/audit.service';
import { sendEmail } from '@/server/services/email.service';
import { env } from '@/lib/env';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const schema = z.object({
  email: z.string().email('Valid email is required'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // Only super_admin can create new admins
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { email } = parsed.data;
    const db = getAdminDb();
    const adminAuth = getAdminAuth();

    // 1. Get or create Firebase Auth user
    let authUser;
    let created = false;
    try {
      authUser = await adminAuth.getUserByEmail(email);
    } catch {
      // User doesn't exist — create them
      authUser = await adminAuth.createUser({ email });
      created = true;
    }

    const newUid = authUser.uid;

    // 2. Check if they're already an admin — don't downgrade a super_admin
    const existingDoc = await db.collection('users').doc(newUid).get();
    if (existingDoc.exists) {
      const existingRole = existingDoc.data()?.role;
      if (existingRole === 'super_admin') {
        throw Errors.validation('Cannot modify a super_admin account via this route.');
      }
    }

    // 3. Upsert users doc with role: admin
    await db.collection('users').doc(newUid).set({
      uid: newUid,
      email: email.toLowerCase().trim(),
      role: 'admin',
      teamId: null,
      invitedTeamId: null,
      isActive: true,
      createdAt: existingDoc.exists ? existingDoc.data()?.createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastLoginAt: existingDoc.exists ? existingDoc.data()?.lastLoginAt : null,
      displayName: existingDoc.exists ? existingDoc.data()?.displayName : null,
    }, { merge: true });

    // 4. Send invitation email
    const baseUrl = process.env.NODE_ENV === 'production' ? 'https://revengershack.tech' : env.NEXT_PUBLIC_APP_URL;
    const loginUrl = `${baseUrl}/login`;
    await sendEmail({
      to: email,
      template: 'admin_invite',
      variables: {
        loginUrl,
      },
    });

    // 5. Write audit log
    await writeAuditLog({
      action: 'admin.created',
      actorUid: token.uid,
      actorRole: 'super_admin',
      targetId: newUid,
      targetType: 'users',
      metadata: {
        email,
        createdAuthAccount: created,
        promotedBy: token.uid,
      },
      ip: null,
    });

    const response = apiSuccess(
      {
        uid: newUid,
        email,
        created,
        message: created
          ? `New admin account created for ${email} and invite sent. They can now log in via OTP.`
          : `Existing user ${email} has been granted admin access and notified.`,
      },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
