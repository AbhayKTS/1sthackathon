import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// 1. Manually load .env.local from workspace root to make sure credentials are populated
try {
  const envPath = path.resolve(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    });
    console.log('Successfully loaded .env.local');
  }
} catch (e) {
  console.error('Failed loading .env.local:', e);
}

// Disable emulator bypass since we want to run against production
if (!process.env.FORCE_EMULATOR && process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

import { getAdminDb, getAdminAuth } from '../lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  const auth = getAdminAuth();

  console.log('--- STARTING FULL RESET ---');

  // STEP 1: Discover protected UIDs before wiping anything
  console.log('\n[1/4] Discovering protected auth users (admin/super_admin/judge/mentor)...');
  const protectedRoles = ['admin', 'super_admin', 'judge', 'mentor'];
  const safeUids = new Set<string>();

  const usersSnap = await db.collection('users').where('role', 'in', protectedRoles).get();
  usersSnap.docs.forEach(doc => safeUids.add(doc.id));

  const permsSnap = await db.collection('permissions').where('role', 'in', protectedRoles).get();
  permsSnap.docs.forEach(doc => safeUids.add(doc.id));

  console.log(`Found ${safeUids.size} protected accounts in Firestore.`);

  // STEP 2: Delete unauthorized Firebase Auth users
  console.log('\n[2/4] Deleting non-admin Firebase Auth users...');
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
  console.log(`Deleted ${authUsersDeleted} orphaned/non-admin auth accounts.`);

  // STEP 3: Wipe Firestore Collections
  console.log('\n[3/4] Wiping participant Firestore collections...');
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
      // Fetch in batches of 450
      const snap = await db.collection(colName).limit(450).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deletedCount += snap.size;
    }
    wipeStats[colName] = deletedCount;
    if (deletedCount > 0) {
      console.log(` - Cleared ${deletedCount} documents from '${colName}'`);
    }
  }

  // STEP 4: Restore super_admin
  console.log('\n[4/4] Restoring super_admin account...');
  try {
    execSync('npx tsx scripts/ensure-super-admin.ts', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (err) {
    console.error('Failed to run ensure-super-admin:', err);
  }

  // FINAL SUMMARY
  console.log('\n=== RESET COMPLETE SUMMARY ===');
  console.log(`Total Auth Users Deleted: ${authUsersDeleted}`);
  console.log('Documents Deleted by Collection:');
  for (const [col, count] of Object.entries(wipeStats)) {
    if (count > 0) console.log(` - ${col}: ${count}`);
  }

  // Check if super admin survived
  try {
    const superAdmin = await auth.getUserByEmail('team@revengershack.tech');
    console.log(`\nVerified: super_admin auth account survived (UID: ${superAdmin.uid})`);
  } catch {
    console.error('\nERROR: super_admin auth account not found!');
  }
}

main()
  .then(() => {
    console.log('\nReset script executed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFatal error in full-reset script:', err);
    process.exit(1);
  });
