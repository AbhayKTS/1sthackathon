/**
 * Firebase Admin SDK — Server-side ONLY.
 *
 * ⚠️  This file must NEVER be imported from client components or pages.
 *     Next.js will tree-shake it correctly as long as it stays in /lib
 *     and is only imported from API routes or Server Actions.
 *
 * Uses singleton pattern to survive Next.js hot-reload without creating
 * duplicate Admin SDK instances (see D-008 in DECISIONS.md).
 *
 * @module firebase-admin
 */

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

// ─── Singleton References ────────────────────────────────────────────────────

let _app: App;
let _auth: Auth;
let _db: Firestore;
let _storage: Storage;

// ─── Initializer ─────────────────────────────────────────────────────────────

function initAdmin(): App {
  // Guard: only initialize once across hot-reloads
  if (getApps().length > 0) {
    return getApps()[0] as App;
  }

  // Support both: single JSON string or individual env vars (D-008)
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };

    return initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        // Replace escaped newlines from env var string encoding
        privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
      }),
      storageBucket: `${serviceAccount.project_id}.appspot.com`,
    });
  }

  // Fallback: individual vars
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin SDK not configured. ' +
        'Set FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON or the individual ' +
        'FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY vars.',
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
    storageBucket: `${projectId}.appspot.com`,
  });
}

// ─── Exported Singletons ─────────────────────────────────────────────────────

/** Firebase Admin App instance */
export function getAdminApp(): App {
  if (!_app) _app = initAdmin();
  return _app;
}

/** Firebase Admin Auth */
export function getAdminAuth(): Auth {
  if (!_auth) _auth = getAuth(getAdminApp());
  return _auth;
}

/** Firebase Admin Firestore */
export function getAdminDb(): Firestore {
  if (!_db) {
    _db = getFirestore(getAdminApp());
    // Use ISO timestamp serialization so dates are consistent across environments
    _db.settings({ ignoreUndefinedProperties: true });
  }
  return _db;
}

/** Firebase Admin Storage */
export function getAdminStorage(): Storage {
  if (!_storage) _storage = getStorage(getAdminApp());
  return _storage;
}
