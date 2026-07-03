const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccountPath = '/Users/havocerebus/Downloads/sthack-88def-firebase-adminsdk-fbsvc-9052c8eef5.json';
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log('Fetching teams with status "Submitted" in production...');

  const snap = await db.collection('teams')
    .where('status', '==', 'Submitted')
    .get();

  if (snap.empty) {
    console.log('No teams found with "Submitted" status.');
    
    // Fallback: print all teams to let the user see what is there
    const allTeams = await db.collection('teams').get();
    if (allTeams.empty) {
      console.log('No teams exist in the database yet.');
    } else {
      console.log('Current teams in database:');
      allTeams.forEach(doc => {
        console.log(`- Team: ${doc.data().teamName} (ID: ${doc.id}), Status: ${doc.data().status}`);
      });
    }
    process.exit(0);
  }

  const batch = db.batch();
  snap.forEach(doc => {
    console.log(`Approving Team: ${doc.data().teamName} (ID: ${doc.id})`);
    batch.update(doc.ref, { status: 'Approved' });
  });

  await batch.commit();
  console.log('Successfully approved all submitted teams!');
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
