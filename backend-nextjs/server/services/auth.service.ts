/**
 * Auth Service — server-side only.
 *
 * Handles OTP issuance, OTP verification, user creation, and token verification.
 * This service has NO dependency on Next.js internals (no NextRequest/NextResponse).
 * It can be lifted into a Firebase Cloud Function with only the API route wrapper changing.
 *
 * @module server/services/auth.service
 */

// NOTE: Implementation is added in Phase 1.
// This file exists as the migration-seam scaffold required by Phase 0.

export {}; // Prevents "isolatedModules" error on empty file
