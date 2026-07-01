// Set up environment variables required by lib/env.ts and Firebase Admin
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-revengershack';
process.env.FIREBASE_ADMIN_PROJECT_ID = 'demo-revengershack';
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = 'test@example.com';
process.env.FIREBASE_ADMIN_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'mock-api-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'demo-revengershack.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'demo-revengershack.firebasestorage.app';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '123456789';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = '1:123:web:456';
process.env.NEXT_PHASE = 'phase-production-build'; // Bypass some env checks if needed

// Emulator configuration — tells Admin SDK to use local emulators
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-revengershack';
