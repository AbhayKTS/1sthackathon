/**
 * POST /api/auth/request-otp
 *
 * Issues an OTP to a shortlisted team leader's email.
 *
 * Flow:
 *   1. Validate request body
 *   2. Check email exists in `invitedTeams` (invite gate)
 *   3. Enforce rate limit (OTP_MAX_PER_HOUR per email)
 *   4. Generate 6-digit OTP, hash + store in `otpCodes`
 *   5. Send OTP via email (Resend or dev-mode console)
 *   6. Write AuditLog
 *   7. Return 200 — always the same response to prevent email enumeration
 *
 * Error codes:
 *   403 NOT_INVITED    — email not in invitedTeams
 *   429 RATE_LIMITED   — too many OTP requests
 *   422 VALIDATION_ERROR — malformed request
 *   500 INTERNAL_ERROR — unexpected failure
 *
 * @route POST /api/auth/request-otp
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
import {
  checkInviteStatus,
  checkAndIncrementRateLimit,
  generateAndStoreOtp,
  checkIpRateLimit,
} from '@/server/services/auth.service';
import { sendEmail } from '@/server/services/email.service';
import { writeAuditLog } from '@/server/services/audit.service';
import { env } from '@/lib/env';

// ─── Request Schema ───────────────────────────────────────────────────────────

const RequestOtpSchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email address.')
    .min(1, 'Email is required.')
    .toLowerCase()
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

    const parsed = RequestOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message ?? 'Invalid request.');
    }

    const { email } = parsed.data;

    // 1b. Check IP-based rate limit
    const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1';
    await checkIpRateLimit(ip);

    // 2. Check invite status (throws NOT_INVITED or FORBIDDEN if not shortlisted)
    const invite = await checkInviteStatus(email);

    // 3. Rate limit check + increment (throws RATE_LIMITED if exceeded)
    await checkAndIncrementRateLimit(email);

    // 4. Generate + store OTP
    const { otp } = await generateAndStoreOtp(email);

    // 5. Send OTP email
    const emailResult = await sendEmail({
      to: email,
      template: 'otp',
      variables: {
        otp,
        expiryMinutes: env.OTP_EXPIRY_MINUTES ?? 10,
        teamName: invite.teamName,
      },
    });

    if (!emailResult.success && !emailResult.devMode) {
      // Email failed — don't leak the OTP; tell user to retry
      throw Errors.emailFailed();
    }

    // 6. Write audit log
    await writeAuditLog({
      action: 'auth.otp_requested',
      actorUid: 'anonymous',
      actorRole: 'anonymous',
      targetId: invite.id,
      targetType: 'invitedTeams',
      metadata: {
        email,
        emailSent: emailResult.success,
        devMode: emailResult.devMode,
      },
      ip: request.headers.get('x-forwarded-for') ?? null,
    });

    // 7. Always return the same response (prevent email enumeration via timing)
    const response = apiSuccess(
      {
        message: `Verification code sent to ${email}. Check your inbox.`,
        expiresInMinutes: env.OTP_EXPIRY_MINUTES ?? 10,
      },
      200,
    );
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
