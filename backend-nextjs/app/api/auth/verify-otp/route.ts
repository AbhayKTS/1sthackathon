/**
 * POST /api/auth/verify-otp
 *
 * Verifies the OTP and issues a Firebase custom token.
 *
 * Flow:
 *   1. Validate request body
 *   2. Re-check invite status (get invitedTeamId for user doc)
 *   3. Find latest valid OTP for email (not expired, not used)
 *   4. Verify OTP hash, enforce max attempts
 *   5. Create or get Firebase Auth user (passwordless)
 *   6. Upsert Firestore `users` doc with role=participant_leader
 *   7. Update `invitedTeams` status → Verified
 *   8. Issue Firebase custom token
 *   9. Return customToken to client
 *
 * The client must then call:
 *   `signInWithCustomToken(auth, customToken)` → gets real ID token
 *   All subsequent requests use `Authorization: Bearer <idToken>`
 *
 * Error codes:
 *   400 OTP_INVALID      — no valid OTP found
 *   400 OTP_EXPIRED      — OTP has expired
 *   403 NOT_INVITED      — email not in invitedTeams
 *   422 VALIDATION_ERROR — wrong code + remaining attempts
 *   429 OTP_MAX_ATTEMPTS — too many wrong attempts
 *   500 INTERNAL_ERROR   — unexpected failure
 *
 * @route POST /api/auth/verify-otp
 * @auth  None required (pre-auth endpoint)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  apiSuccess,
  apiError,
  applyCorsHeaders,
  handleOptions,
} from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { verifyOtpAndCreateSession } from '@/server/services/auth.service';

// ─── Request Schema ───────────────────────────────────────────────────────────

const VerifyOtpSchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email address.')
    .min(1, 'Email is required.')
    .toLowerCase()
    .trim(),
  code: z
    .string()
    .regex(/^\d{6}$/, 'OTP must be a 6-digit number.')
    .min(1, 'OTP code is required.')
    .trim(),
});

// ─── Route Handlers ───────────────────────────────────────────────────────────

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Parse + validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw Errors.validation('Request body must be valid JSON.');
    }

    const parsed = VerifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message ?? 'Invalid request.');
    }

    const { email, code } = parsed.data;

    // 2–9. Delegated to auth service (invite check, OTP verify, user create, token)
    const result = await verifyOtpAndCreateSession(email, code);

    // 10. Return custom token + user info
    const response = apiSuccess(
      {
        customToken: result.customToken,
        user: {
          uid: result.uid,
          email: result.email,
          role: result.role,
        },
        isNewUser: result.isNewUser,
        message: result.isNewUser
          ? 'Account created successfully. Welcome to RevengersHack!'
          : 'Verification successful. Welcome back!',
        // Client next step — tell the frontend what page to redirect to
        nextStep: 'team-completion', // Phase 4: complete team profile
      },
      200,
    );
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
