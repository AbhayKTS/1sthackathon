/**
 * seed-firestore.ts
 *
 * Seeds all required Firestore collections for the RevengersHack platform.
 * Safe to run multiple times (uses merge/set with merge:true).
 *
 * Required collections seeded:
 *   - settings/platform     — platform flags (maintenance, emergency, registrations)
 *   - settings/registration — registration window config
 *   - rounds/{roundId}      — hackathon rounds (round-1, round-2, round-3)
 *
 * Usage:
 *   npx tsx scripts/seed-firestore.ts
 *
 * To target production (not emulator):
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON="..." npx tsx scripts/seed-firestore.ts
 */

import fs from 'fs';
import path from 'path';
import { FieldValue } from 'firebase-admin/firestore';

// ─── Load .env.local ─────────────────────────────────────────────────────────
try {
  // Try workspace root first, then backend-nextjs dir
  const envPaths = [
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(__dirname, '../.env.local'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const envFile = fs.readFileSync(envPath, 'utf8');
      envFile.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
        if (match) {
          const key = match[1]!;
          let val = match[2]!.trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          if (!process.env[key]) process.env[key] = val;
        }
      });
      console.log(`Loaded env from: ${envPath}`);
      break;
    }
  }
} catch (e) {
  console.error('Warning: Could not load .env.local:', e);
}

// Force production (not emulator) if service account JSON is present
if (!process.env.FORCE_EMULATOR && process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  console.log('Targeting PRODUCTION Firestore (service account found).');
} else {
  console.log('Targeting EMULATOR Firestore.');
}

import { getAdminDb } from '../lib/firebase-admin';

// ─── Seed Data ────────────────────────────────────────────────────────────────

async function main() {
  const db = getAdminDb();
  const now = new Date();

  console.log('\n=== SEEDING FIRESTORE ===\n');

  // ── 1. settings/platform ──────────────────────────────────────────────────
  console.log('[1/3] Seeding settings/platform...');
  await db.collection('settings').doc('platform').set({
    maintenanceMode: false,
    emergencyMode: false,
    registrationsPaused: false,
    sheetsPaused: false,
    announcementsEnabled: true,
    updatedAt: FieldValue.serverTimestamp(),
    seededAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('  ✓ settings/platform seeded');

  // ── 2. settings/registration ──────────────────────────────────────────────
  console.log('[2/3] Seeding settings/registration...');
  await db.collection('settings').doc('registration').set({
    isOpen: true,
    maxTeamSize: 4,
    minTeamSize: 2,
    maxTeams: 100,
    updatedAt: FieldValue.serverTimestamp(),
    seededAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('  ✓ settings/registration seeded');

  // ── 3. rounds ─────────────────────────────────────────────────────────────
  console.log('[3/3] Seeding rounds...');
  const rounds = [
    {
      id: 'round-1',
      name: 'Round 1 — Idea Pitch',
      shortName: 'R1',
      type: 'ppt',
      status: 'inactive', // 'active' | 'inactive' | 'completed'
      order: 1,
      submissionType: 'ppt',
      description: 'Teams present their idea via a PowerPoint presentation.',
      maxSubmissions: 1,
      allowResubmission: true,
    },
    {
      id: 'round-2',
      name: 'Round 2 — Prototype Demo',
      shortName: 'R2',
      type: 'prototype',
      status: 'inactive',
      order: 2,
      submissionType: 'prototype',
      description: 'Teams submit a working prototype link.',
      maxSubmissions: 1,
      allowResubmission: true,
    },
    {
      id: 'round-3',
      name: 'Round 3 — Final Presentation',
      shortName: 'R3',
      type: 'github',
      status: 'inactive',
      order: 3,
      submissionType: 'github',
      description: 'Final round — submit GitHub repo and live demo.',
      maxSubmissions: 1,
      allowResubmission: false,
    },
  ];

  for (const round of rounds) {
    const { id, ...data } = round;
    await db.collection('rounds').doc(id).set({
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      seededAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✓ rounds/${id} seeded`);
  }

  // ── 4. Verify settings/sheets-sync-lock exists (prevent lock issues) ──────
  const lockSnap = await db.collection('settings').doc('sheets-sync-lock').get();
  if (!lockSnap.exists) {
    await db.collection('settings').doc('sheets-sync-lock').set({
      locked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log('  ✓ settings/sheets-sync-lock initialized');
  } else {
    // Release any stale lock
    await db.collection('settings').doc('sheets-sync-lock').update({
      locked: false,
      releasedAt: FieldValue.serverTimestamp(),
    });
    console.log('  ✓ settings/sheets-sync-lock released any stale lock');
  }

  console.log('\n=== SEED COMPLETE ===');
  console.log('Collections seeded:');
  console.log('  - settings/platform');
  console.log('  - settings/registration');
  console.log('  - settings/sheets-sync-lock');
  console.log('  - rounds/round-1');
  console.log('  - rounds/round-2');
  console.log('  - rounds/round-3');
  console.log('\nNOTE: invitedTeams are created by admins via the Command Center.');
  console.log('      Use /api/admin/import-teams or cmd-center.html to add teams.');
}

main()
  .then(() => {
    console.log('\nSeed script executed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFatal error in seed script:', err);
    process.exit(1);
  });
