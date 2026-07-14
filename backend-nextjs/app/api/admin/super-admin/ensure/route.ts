import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { writeAuditLog } from '@/server/services/audit.service';
import { FieldValue } from 'firebase-admin/firestore';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // Authenticate using CRON_SECRET to bypass chicken-and-egg problem
    const authHeader = request.headers.get('authorization');
    const secret = authHeader?.replace('Bearer ', '').trim();

    if (!secret || secret !== process.env.CRON_SECRET) {
      throw Errors.forbidden('Unauthorized. Invalid CRON_SECRET.');
    }

    const db = getAdminDb();
    const auth = getAdminAuth();
    const targetEmail = 'team@revengershack.tech';
    const logs: string[] = [];

    logs.push(`Starting super_admin security configuration...`);

    // 1. Find or create Firebase Auth user for team@revengershack.tech
    let uid = '';
    try {
      const userRecord = await auth.getUserByEmail(targetEmail);
      uid = userRecord.uid;
      logs.push(`Found existing Firebase Auth user for ${targetEmail} (UID: ${uid})`);
    } catch (error) {
      logs.push(`Firebase Auth user for ${targetEmail} not found. Creating...`);
      const newUserRecord = await auth.createUser({
        email: targetEmail,
        emailVerified: true,
      });
      uid = newUserRecord.uid;
      logs.push(`Successfully created Firebase Auth user for ${targetEmail} (UID: ${uid})`);
    }

    // 2. Ensure Firestore Users doc has role: 'super_admin' and isActive: true
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      logs.push(`Firestore user doc for ${targetEmail} does not exist. Creating...`);
      await userRef.set({
        uid,
        email: targetEmail,
        role: 'super_admin',
        displayName: 'System Super Admin',
        teamId: null,
        invitedTeamId: null,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      logs.push(`Created user doc with role: 'super_admin'`);
    } else {
      const currentData = userSnap.data()!;
      if (currentData.role !== 'super_admin' || currentData.isActive !== true) {
        logs.push(`Updating existing Firestore user doc for ${targetEmail} to role: 'super_admin', isActive: true`);
        await userRef.update({
          role: 'super_admin',
          isActive: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        logs.push(`Updated successfully.`);
      } else {
        logs.push(`Firestore user doc for ${targetEmail} is already super_admin and active.`);
      }
    }

    // 3. Scan the entire Users collection and demote other super_admins
    logs.push(`Scanning Users collection for other super_admin accounts...`);
    const usersSnap = await db.collection('users').where('role', '==', 'super_admin').get();
    let demotionCount = 0;

    for (const doc of usersSnap.docs) {
      const userData = doc.data();
      if (userData.email.toLowerCase() !== targetEmail) {
        logs.push(`Demoting unauthorized super_admin: ${userData.email} (UID: ${doc.id})`);
        
        // Update Users doc
        await db.collection('users').doc(doc.id).update({
          role: 'admin',
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Update permissions doc if it exists
        const permRef = db.collection('permissions').doc(doc.id);
        const permSnap = await permRef.get();
        if (permSnap.exists) {
          await permRef.update({
            role: 'admin',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // Log demotion via writeAuditLog
        await writeAuditLog({
          action: 'admin.permission_changed',
          actorUid: 'SYSTEM',
          actorRole: 'super_admin',
          targetId: doc.id,
          targetType: 'users',
          metadata: {
            email: userData.email,
            reason: 'System policy: only team@revengershack.tech can hold super_admin role.',
          },
          ip: null,
        });

        demotionCount++;
      }
    }

    logs.push(`Scan complete. Demoted ${demotionCount} unauthorized super_admin accounts.`);

    const response = apiSuccess({ success: true, demoted: demotionCount, logs }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
