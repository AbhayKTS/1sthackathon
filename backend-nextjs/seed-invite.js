const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Read the service account key
const serviceAccountPath = '/Users/havocerebus/Downloads/sthack-88def-firebase-adminsdk-fbsvc-9052c8eef5.json';
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const email = 'q.a@revengershack.tech';

  console.log(`Adding ${email} to invitedTeams in production Firestore...`);

  // Query if already exists
  const existing = await db.collection('invitedTeams')
    .where('leaderEmail', '==', email.toLowerCase())
    .get();

  if (!existing.empty) {
    console.log(`Document for ${email} already exists in invitedTeams.`);
    process.exit(0);
  }

  // Create new document
  const inviteRef = db.collection('invitedTeams').doc();
  await inviteRef.set({
    teamName: 'Flowpulse',
    leaderName: 'Ansh',
    leaderEmail: email.toLowerCase(),
    leaderPhone: '+919999999999',
    college: 'Flowpulse HQ',
    status: 'Invited',
    invitedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`Successfully added ${email} to production invitedTeams!`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error running script:', err);
  process.exit(1);
});
