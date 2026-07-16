import { type NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const db = getAdminDb();
    const auth = getAdminAuth();

    const protectedRoles = ['admin', 'super_admin', 'judge', 'mentor'];
    const safeUids = new Set<string>();

    const usersSnap = await db.collection('users').where('role', 'in', protectedRoles).get();
    usersSnap.docs.forEach(doc => safeUids.add(doc.id));

    const permsSnap = await db.collection('permissions').where('role', 'in', protectedRoles).get();
    permsSnap.docs.forEach(doc => safeUids.add(doc.id));

    let nextPageToken;
    let authUsersDeleted = 0;
    do {
      const listUsersResult = await auth.listUsers(1000, nextPageToken);
      for (const userRecord of listUsersResult.users) {
        if (!safeUids.has(userRecord.uid)) {
          await auth.deleteUser(userRecord.uid);
          authUsersDeleted++;
        }
      }
      nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);

    const collectionsToClear = [
      'teams', 'users', 'invitedTeams', 'submissions', 'sessions', 'mentorSlots',
      'evaluations', 'mailQueue', 'emailLogs', 'googleSheets', 'announcements',
      'leaderboard', 'standings', 'tickets', 'activityLogs', 'auditLogs',
      'notifications', 'otpCodes', 'otpRateLimits', 'permissions', 'joinGangLeads'
    ];

    const wipeStats: Record<string, number> = {};

    for (const colName of collectionsToClear) {
      let deletedCount = 0;
      while (true) {
        const snap = await db.collection(colName).limit(450).get();
        if (snap.empty) break;

        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        deletedCount += snap.size;
      }
      wipeStats[colName] = deletedCount;
    }

    // Recreate super_admin since we wiped it
    const targetEmail = 'team@revengershack.tech';
    let uid = '';
    try {
      const userRecord = await auth.getUserByEmail(targetEmail);
      uid = userRecord.uid;
    } catch {
      const newUserRecord = await auth.createUser({ email: targetEmail, emailVerified: true });
      uid = newUserRecord.uid;
    }
    await db.collection('users').doc(uid).set({
      uid, email: targetEmail, role: 'super_admin', displayName: 'System Super Admin',
      teamId: null, invitedTeamId: null, isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    });

    return NextResponse.json({ success: true, authUsersDeleted, wipeStats });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
