/**
 * One-time migration: fix `rounds` docs that have a missing or invalid `status`
 * field (i.e. docs that predate the round state machine).
 *
 * Mapping logic:
 *   isActive === true  → 'Active'
 *   isLocked === true  → 'Locked'
 *   otherwise          → 'Draft'
 *
 * Safe to run multiple times — docs that already have a valid status are skipped.
 *
 * Usage:
 *   node scripts/migrate-round-status.js           # dry-run (logs only, no writes)
 *   node scripts/migrate-round-status.js --commit  # actually writes to Firestore
 *
 * Requires: local service account file at the path in SA_PATH env var, or the
 * default path below; OR set FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON to the JSON string.
 */

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');

// ─── Firebase Admin Init ───────────────────────────────────────────────────────

let credential;
if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
  credential = admin.credential.cert(
    JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON)
  );
} else {
  const saPath =
    process.env.SA_PATH ||
    '/Users/havocerebus/Downloads/sthack-88def-firebase-adminsdk-fbsvc-9052c8eef5.json';
  credential = admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
}

if (!admin.apps.length) {
  admin.initializeApp({ credential });
}

const db = admin.firestore();

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set([
  'Draft', 'Published', 'Active', 'Locked', 'Evaluation', 'Completed', 'Archived',
]);

/** Derive a sensible status from legacy boolean fields. */
function deriveStatus(data) {
  if (data.isActive === true)  return 'Active';
  if (data.isLocked === true)  return 'Locked';
  return 'Draft';
}

// ─── Migration ────────────────────────────────────────────────────────────────

async function migrateRoundStatus() {
  const isDryRun = !process.argv.includes('--commit');

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Round Status Migration');
  console.log(`  Mode: ${isDryRun ? '🔍 DRY-RUN (pass --commit to write)' : '✍️  COMMIT — writing to Firestore'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const snap = await db.collection('rounds').get();

  if (snap.empty) {
    console.log('⚠️  No documents found in the rounds collection.');
    process.exit(0);
  }

  console.log(`📋 Total rounds found: ${snap.docs.length}\n`);

  // ── Preview round-1 and round-2 specifically before doing anything ────────
  const WATCH_IDS = ['round-1', 'round-2'];
  console.log('── Pre-migration state of watched rounds ─────────────');
  for (const id of WATCH_IDS) {
    const doc = snap.docs.find(d => d.id === id);
    if (!doc) {
      console.log(`  ${id}: NOT FOUND`);
      continue;
    }
    const d = doc.data();
    console.log(
      `  ${id}: status="${d.status ?? '(missing)'}"` +
      `  isActive=${d.isActive}  isLocked=${d.isLocked}` +
      (VALID_STATUSES.has(d.status) ? '  ✅ already valid' : `  → would set → "${deriveStatus(d)}"`)
    );
  }
  console.log('');

  // ── Scan every doc ────────────────────────────────────────────────────────
  const toFix = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (VALID_STATUSES.has(data.status)) continue; // already valid — skip

    const newStatus = deriveStatus(data);
    toFix.push({ ref: doc.ref, id: doc.id, oldStatus: data.status, newStatus, data });
  }

  if (toFix.length === 0) {
    console.log('✅ All round documents already have a valid status. Nothing to do.\n');
    process.exit(0);
  }

  // ── Log what would (or will) change ───────────────────────────────────────
  console.log('── Docs requiring migration ──────────────────────────');
  for (const item of toFix) {
    console.log(
      `  ${item.id}: "${item.oldStatus ?? '(missing)'}"` +
      `  isActive=${item.data.isActive}  isLocked=${item.data.isLocked}` +
      `  →  "${item.newStatus}"`
    );
  }
  console.log('');

  if (isDryRun) {
    console.log(`🔍 Dry-run complete. ${toFix.length} document(s) would be updated.`);
    console.log('   Re-run with --commit to apply changes.\n');
    process.exit(0);
  }

  // ── Apply in batches ──────────────────────────────────────────────────────
  const BATCH_SIZE = 400;
  let written = 0;

  for (let i = 0; i < toFix.length; i += BATCH_SIZE) {
    const chunk = toFix.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const item of chunk) {
      batch.update(item.ref, {
        status:    item.newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Preserve backward-compat booleans in sync with the new status
        ...(item.newStatus === 'Active' ? { isActive: true,  isLocked: false } : {}),
        ...(item.newStatus === 'Locked' ? { isActive: false, isLocked: true  } : {}),
        ...(item.newStatus === 'Draft'  ? { isActive: false, isLocked: false } : {}),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  ✅ Batch committed: ${written}/${toFix.length}`);
  }

  // ── Post-migration verification ───────────────────────────────────────────
  console.log('\n── Post-migration state of watched rounds ────────────');
  for (const id of WATCH_IDS) {
    const doc = await db.collection('rounds').doc(id).get();
    if (!doc.exists) {
      console.log(`  ${id}: NOT FOUND`);
      continue;
    }
    const d = doc.data();
    console.log(
      `  ${id}: status="${d.status}"` +
      `  isActive=${d.isActive}  isLocked=${d.isLocked}` +
      (VALID_STATUSES.has(d.status) ? '  ✅' : '  ❌ STILL INVALID')
    );
  }

  console.log(`\n📊 Migration complete. ${written} document(s) updated.\n`);
  process.exit(0);
}

migrateRoundStatus().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
