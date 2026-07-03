const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccountPath = '/Users/havocerebus/Downloads/sthack-88def-firebase-adminsdk-fbsvc-9052c8eef5.json';
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const email = 'q.a@revengershack.tech';
  
  console.log(`Searching for user with email "${email}" in production...`);

  const snap = await db.collection('users')
    .where('email', '==', email.toLowerCase())
    .limit(1)
    .get();

  if (snap.empty) {
    console.log(`Error: No user document found for ${email}.`);
    console.log('Make sure you have logged in at least once with this email on the site first so your user account is created!');
    process.exit(1);
  }

  const userDoc = snap.docs[0];
  console.log(`Found user: ${email} (UID: ${userDoc.id}). Upgrading role to "admin"...`);

  await userDoc.ref.update({ role: 'admin' });
  console.log(`Successfully upgraded ${email} to admin!`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
