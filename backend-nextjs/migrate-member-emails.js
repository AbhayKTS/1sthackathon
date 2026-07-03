const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccountPath = '/Users/havocerebus/Downloads/sthack-88def-firebase-adminsdk-fbsvc-9052c8eef5.json';
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log('Fetching all teams in production Firestore for memberEmails migration...');

  const snap = await db.collection('teams').get();

  if (snap.empty) {
    console.log('No teams found in the database.');
    process.exit(0);
  }

  const batch = db.batch();
  let migratedCount = 0;

  snap.forEach(doc => {
    const data = doc.data();
    const members = data.members || [];
    
    if (members.length > 0) {
      const memberEmails = members.map(m => (m.email || '').toLowerCase()).filter(Boolean);
      console.log(`Migrating Team: ${data.teamName} (ID: ${doc.id}) -> memberEmails:`, memberEmails);
      
      batch.update(doc.ref, { memberEmails });
      migratedCount++;
    }
  });

  if (migratedCount > 0) {
    await batch.commit();
    console.log(`Successfully migrated ${migratedCount} teams!`);
  } else {
    console.log('No teams needed migration.');
  }
  
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
