import fs from 'fs';
import path from 'path';

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

// Load service account JSON if necessary (removed hardcoded path for security)
if (!process.env.FORCE_EMULATOR && process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
  // Disable emulator bypass since we want to run against production
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

import { getAdminDb, getAdminAuth } from '../lib/firebase-admin';
import { writeAuditLog } from '../server/services/audit.service';
import { FieldValue } from 'firebase-admin/firestore';

async function main() {
  const db = getAdminDb();
  const auth = getAdminAuth();
  const targetEmail = 'team@revengershack.tech';

  console.log(`Starting super_admin security configuration...`);

  // 1. Find or create Firebase Auth user for team@revengershack.tech, falling back gracefully on restricted permissions
  let uid = '';
  const existingUserQuery = await db.collection('users').where('email', '==', targetEmail).limit(1).get();
  
  if (!existingUserQuery.empty) {
    uid = existingUserQuery.docs[0].id;
    console.log(`Found existing Firestore user doc for ${targetEmail} (UID: ${uid})`);
  } else {
    try {
      const userRecord = await auth.getUserByEmail(targetEmail);
      uid = userRecord.uid;
      console.log(`Found existing Firebase Auth user for ${targetEmail} (UID: ${uid})`);
    } catch (authError: any) {
      if (authError.code === 'auth/insufficient-permission') {
        console.warn(`WARNING: Insufficient permission to query Firebase Auth. Using deterministic UID for Firestore.`);
        uid = 'super_admin_revengershack';
      } else {
        // User not found in auth, try to create
        try {
          console.log(`Firebase Auth user for ${targetEmail} not found. Creating...`);
          const newUserRecord = await auth.createUser({
            email: targetEmail,
            emailVerified: true,
          });
          uid = newUserRecord.uid;
          console.log(`Successfully created Firebase Auth user for ${targetEmail} (UID: ${uid})`);
        } catch (createError: any) {
          console.warn(`WARNING: Failed to create Auth user: ${createError.message}. Using deterministic UID.`);
          uid = 'super_admin_revengershack';
        }
      }
    }
  }

  // 2. Ensure Firestore Users doc has role: 'super_admin' and isActive: true
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  
  if (!userSnap.exists) {
    console.log(`Firestore user doc for ${targetEmail} does not exist. Creating...`);
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
    console.log(`Created user doc with role: 'super_admin'`);
  } else {
    const currentData = userSnap.data()!;
    if (currentData.role !== 'super_admin' || currentData.isActive !== true) {
      console.log(`Updating existing Firestore user doc for ${targetEmail} to role: 'super_admin', isActive: true`);
      await userRef.update({
        role: 'super_admin',
        isActive: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`Updated successfully.`);
    } else {
      console.log(`Firestore user doc for ${targetEmail} is already super_admin and active.`);
    }
  }

  // 3. Scan the entire Users collection and demote other super_admins
  console.log(`Scanning Users collection for other super_admin accounts...`);
  const usersSnap = await db.collection('users').where('role', '==', 'super_admin').get();
  let demotionCount = 0;

  for (const doc of usersSnap.docs) {
    const userData = doc.data();
    if (userData.email.toLowerCase() !== targetEmail) {
      console.log(`Demoting unauthorized super_admin: ${userData.email} (UID: ${doc.id})`);
      
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

  console.log(`Scan complete. Demoted ${demotionCount} unauthorized super_admin accounts.`);
}

main()
  .then(() => {
    console.log(`Finished ensure-super-admin successfully.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`Error in ensure-super-admin:`, err);
    process.exit(1);
  });
