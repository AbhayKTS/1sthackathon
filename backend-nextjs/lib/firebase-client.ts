/**
 * Firebase Client SDK configuration.
 *
 * Safe to import from client components — all values come from
 * NEXT_PUBLIC_ environment variables.
 *
 * Do NOT import firebase-admin here. This file is client-safe.
 *
 * @module firebase-client
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// NOTE: These env vars are validated at startup by lib/env.ts.
// The non-null assertions (!) are safe — if any var is missing, the server
// will fail before reaching this code with a clear error message.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  // Omit measurementId if not set — exactOptionalPropertyTypes requires
  // we don't pass `undefined` for optional properties
  ...(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
    ? { measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID }
    : {}),
};

// ─── Singleton (safe for client hot-reloads) ─────────────────────────────────

let _clientApp: FirebaseApp;
let _clientAuth: Auth;
let _clientDb: Firestore;
let _clientStorage: FirebaseStorage;

export function getClientApp(): FirebaseApp {
  if (!_clientApp) {
    _clientApp = getApps().length > 0 ? (getApps()[0] as FirebaseApp) : initializeApp(firebaseConfig);
  }
  return _clientApp;
}

export function getClientAuth(): Auth {
  if (!_clientAuth) _clientAuth = getAuth(getClientApp());
  return _clientAuth;
}

export function getClientDb(): Firestore {
  if (!_clientDb) _clientDb = getFirestore(getClientApp());
  return _clientDb;
}

export function getClientStorage(): FirebaseStorage {
  if (!_clientStorage) _clientStorage = getStorage(getClientApp());
  return _clientStorage;
}
