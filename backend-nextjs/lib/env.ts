import { z } from 'zod';

/**
 * Validates all required environment variables at startup.
 * Throws immediately with a clear message if any required var is missing.
 * This prevents the server from starting in a misconfigured state.
 *
 * @module env
 */

// ─── Schema Definition ──────────────────────────────────────────────────────

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Firebase Admin — at least one of the two forms must be present.
  // Validation of which form is used happens in firebase-admin.ts
  FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_ADMIN_PROJECT_ID: z.string().optional(),
  FIREBASE_ADMIN_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_ADMIN_PRIVATE_KEY: z.string().optional(),

  // Firebase Client SDK (public)
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: z.string().optional(),

  // Email Providers
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@revengershack.tech'),
  EMAIL_FROM_NAME: z.string().min(1).default('RevengersHack'),

  // CORS
  ALLOWED_ORIGINS: z.string().min(1),

  // OTP Rate Limiting
  OTP_MAX_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // Google Sheets Sync — server-side only, NEVER exposed to client
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SHEET_PPT_ID: z.string().optional(),
  GOOGLE_SHEET_PROTO_ID: z.string().optional(),

  // Internal Cron Secret — protects /api/internal/* endpoints
  // Set this to a long random string (e.g., openssl rand -hex 32)
  CRON_SECRET: z.string().optional(),

  // Announcement Broadcast Channels
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_API_URL: z.string().url().optional(),

  // Mail Queue Processing
  MAIL_QUEUE_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  MAIL_QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  // Google Sheets Queue Processing
  SHEETS_QUEUE_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  SHEETS_QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

// ─── Parse & Export ─────────────────────────────────────────────────────────

// Skip strict validation at Next.js build time.
// During `next build`, page data collection runs server code without real env vars.
// Validation is enforced at runtime (dev server start + Vercel cold start).
const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build';

const _parsed = isBuildTime
  ? // Lenient parse at build time — missing vars are allowed
    envSchema.partial().safeParse(process.env)
  : envSchema.safeParse(process.env);

if (!_parsed.success && !isBuildTime) {
  // Format the errors for readable startup failure
  const formatted = _parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `\n\n❌ Invalid environment configuration:\n${formatted}\n\n` +
      `Copy .env.local.example to .env.local and fill in all required values.\n`,
  );
}

// At build time, use a partial object (some vars may be undefined)
// At runtime, all vars are present and validated
export const env = (_parsed.data ?? {}) as z.infer<typeof envSchema>;

/** Parsed allowed origins as an array */
export const allowedOrigins: string[] = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:5173'];

/** Base URL for the participant portal */
export function getPortalBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') return 'https://revengershack.tech';
  return env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173';
}

/** Base URL for the admin panel */
export function getAdminBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') return 'https://api.revengershack.tech';
  return 'http://localhost:3001';
}
