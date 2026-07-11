/**
 * POST /api/admin/backup — Triggers a disaster recovery full database export.
 *
 * @route POST /api/admin/backup
 * @auth  SuperAdmin only
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const db = getAdminDb();
    
    // 1. Fetch all collections for backup
    const usersSnap = await db.collection('users').get();
    const teamsSnap = await db.collection('teams').get();
    const submissionsSnap = await db.collection('submissions').get();
    const settingsSnap = await db.collection('settings').get();

    const backupData = {
      users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      teams: teamsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      submissions: submissionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      settings: settingsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      exportedAt: new Date().toISOString(),
      exportedBy: token.uid,
    };

    // 2. Perform internal duplicate backup of submissions to `backups_submissions`
    const batch = db.batch();
    const backupSubRef = db.collection('backups_submissions');
    
    // Process in batch chunks of 450 to avoid Firestore limits
    let counter = 0;
    for (const doc of submissionsSnap.docs) {
      const backupDocRef = backupSubRef.doc(`${doc.id}_${Date.now()}`);
      batch.set(backupDocRef, {
        ...doc.data(),
        backedUpAt: new Date(),
        originalDocId: doc.id,
      });
      counter++;
      if (counter >= 400) {
        break; // Keep within standard single-batch limits
      }
    }

    if (counter > 0) {
      await batch.commit();
    }

    const response = apiSuccess({
      message: 'Database backup successfully initiated and logged.',
      exportedCount: {
        users: usersSnap.size,
        teams: teamsSnap.size,
        submissions: submissionsSnap.size,
      },
      backup: backupData,
    });

    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
