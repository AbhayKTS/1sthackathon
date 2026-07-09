/**
 * One-off migration script: backfills `isActive: true` on any `users` doc
 * where the field is missing (undefined). Safe to run multiple times.
 *
 * Usage:
 *   node scripts/backfill-isactive.js
 *
 * Requires: FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON env var, or the path below.
 */

const admin = require('firebase-admin');
const fs = require('fs');

// ─── Init ─────────────────────────────────────────────────────────────────────
let credential;
if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
  const sa = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON);
  credential = admin.credential.cert(sa);
} else {
  // Fallback: local service account file (never commit this path)
  const saPath = process.env.SA_PATH || '/Users/havocerebus/Downloads/sthack-88def-firebase-adminsdk-fbsvc-9052c8eef5.json';
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  credential = admin.credential.cert(sa);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential });
}

const db = admin.firestore();

// ─── Migration ────────────────────────────────────────────────────────────────

async function backfillIsActive() {
  console.log('🔍 Scanning users collection for docs missing isActive field...\n');

  const BATCH_SIZE = 400; // Keep under Firestore batch limit of 500
  let totalScanned = 0;
  let totalPatched = 0;
  let lastDoc = null;

  while (true) {
    let q = db.collection('users').limit(BATCH_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    totalScanned += snap.docs.length;

    // Find docs where isActive is undefined (field not present)
    const toFix = snap.docs.filter(doc => {
      const data = doc.data();
      return data.isActive === undefined;
    });

    if (toFix.length > 0) {
      const batch = db.batch();
      for (const doc of toFix) {
        batch.update(doc.ref, {
          isActive: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`  ✅ Patching user: ${doc.id} (${doc.data().email || 'no email'})`);
      }
      await batch.commit();
      totalPatched += toFix.length;
    }

    if (snap.docs.length < BATCH_SIZE) break; // Last page
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  console.log(`\n📊 Migration complete.`);
  console.log(`   Total scanned : ${totalScanned}`);
  console.log(`   Total patched : ${totalPatched}`);
  console.log(`   Already OK    : ${totalScanned - totalPatched}`);

  if (totalPatched === 0) {
    console.log('\n✅ No docs needed patching — all users already have isActive set.');
  } else {
    console.log(`\n⚠️  ${totalPatched} user doc(s) were missing isActive and have been set to true.`);
  }

  process.exit(0);
}

backfillIsActive().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
