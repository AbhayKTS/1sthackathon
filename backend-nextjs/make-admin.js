const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccountPath = '/Users/havocerebus/Downloads/sthack-88def-firebase-adminsdk-fbsvc-9052c8eef5.json';
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

async function run() {
  // CHANGE THIS EMAIL to add/promote other admin users (e.g. your friends)
  const email = 'team@revengershack.tech';
  const normalizedEmail = email.toLowerCase().trim();
  
  console.log(`Setting up Admin rights for: ${normalizedEmail}...`);

  let uid = '';

  // 1. Get or Create in Firebase Auth
  try {
    const existingUser = await auth.getUserByEmail(normalizedEmail);
    uid = existingUser.uid;
    console.log(`- Found existing Firebase Auth account (UID: ${uid})`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      const newUser = await auth.createUser({
        email: normalizedEmail,
        emailVerified: true
      });
      uid = newUser.uid;
      console.log(`- Created new Firebase Auth account (UID: ${uid})`);
    } else {
      throw err;
    }
  }

  // 2. Upsert in Firestore Users collection
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    await userRef.set({
      uid,
      email: normalizedEmail,
      role: 'super_admin',
      teamId: null,
      invitedTeamId: null,
      displayName: 'Admin User',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: null,
      isActive: true
    });
    console.log(`- Created new Firestore user document with "admin" role.`);
  } else {
    await userRef.update({
      role: 'super_admin',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`- Updated existing Firestore user document to "admin" role.`);
  }

  console.log(`\n🎉 Success! ${normalizedEmail} is now a live Administrator.`);
  console.log(`They can log in at https://revengershack.tech/login and access https://revengershack.tech/cmd-center.html`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
