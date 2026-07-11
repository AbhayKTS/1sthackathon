/**
 * API Route middleware utilities.
 *
 * Every privileged API route MUST call these helpers in order:
 *   1. withAuth(request)  — verifies Firebase ID token, returns decoded token
 *   2. requireRole(token, ['admin']) — checks role against Firestore Users doc
 *   3. Your business logic / service call
 *
 * CORS headers are applied via next.config.ts and the withCors wrapper here
 * for OPTIONS preflight handling.
 *
 * @module api-helpers
 */

import { type NextRequest, NextResponse } from 'next/server';
import { AppError, Errors } from './errors';
import { getAdminAuth, getAdminDb } from './firebase-admin';
import { isAllowedOrigin } from './env';
import type { UserRole } from '@/types/auth';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedToken {
  uid: string;
  email: string;
  role: UserRole;
}

// ─── Token Verification ───────────────────────────────────────────────────────

/**
 * Extracts and verifies the Firebase ID token from the Authorization header.
 * Returns the decoded token payload including uid and email.
 * Throws AppError(401) if token is missing or invalid.
 */
export async function withAuth(request: NextRequest): Promise<AuthenticatedToken> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw Errors.unauthorized('Missing or malformed Authorization header. Expected: Bearer <token>');
  }

  const idToken = authHeader.slice(7);

  let decoded: { uid: string; email?: string };

  try {
    // E2E Simulation Bypass (Only allowed in non-production emulator)
    if (idToken.startsWith('MOCK_TOKEN_') && process.env.FIRESTORE_EMULATOR_HOST && process.env.NODE_ENV !== 'production') {
      const uid = idToken.replace('MOCK_TOKEN_', '');
      decoded = { uid, email: `${uid}@mock.com` };
    } else {
      decoded = await getAdminAuth().verifyIdToken(idToken, true); // checkRevoked=true
    }

    // Fetch role from Firestore — token custom claims are not set yet in this impl,
    // so role is always read from the Users doc server-side (see D-005).
    const userSnap = await getAdminDb().collection('users').doc(decoded.uid).get();

    if (!userSnap.exists) {
      throw Errors.unauthorized('User account not found. Please contact support.');
    }

    const userData = userSnap.data()!;

    if (userData.isActive === false) {
      throw Errors.forbidden('Your account has been deactivated. Please contact support.');
    }

    // Maintenance Mode Check
    const role = userData.role as UserRole;
    if (role !== 'super_admin' && role !== 'admin') {
      const settingsSnap = await getAdminDb().collection('settings').doc('platform').get();
      if (settingsSnap.exists) {
        const settingsData = settingsSnap.data()!;
        if (settingsData['maintenanceMode'] === true) {
          throw new AppError('Platform is currently undergoing maintenance. Please try again later.', 503, 'INTERNAL_ERROR');
        }
      }
    }

    return {
      uid: decoded.uid,
      email: decoded.email ?? userData.email,
      role,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Firebase token errors (expired, revoked, malformed)
    throw Errors.unauthorized('Invalid or expired session token. Please sign in again.');
  }
}

/**
 * Checks that the authenticated user's role is in the allowed list.
 * Throws AppError(403) if role is not permitted.
 *
 * @example
 *   requireRole(token, ['admin', 'super_admin'])
 */
export function requireRole(token: AuthenticatedToken, roles: UserRole[]): void {
  if (!roles.includes(token.role)) {
    throw Errors.forbidden(
      `This action requires one of the following roles: ${roles.join(', ')}. Your role: ${token.role}`,
    );
  }
}

// ─── Response Helpers ─────────────────────────────────────────────────────────

/**
 * Standard success response with CORS headers attached.
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

/**
 * Maps AppError and unknown errors to a standard JSON error response.
 * Never exposes stack traces in production.
 */
export function apiError(err: unknown, origin?: string): NextResponse {
  const isProd = process.env.NODE_ENV === 'production';

  if (err instanceof AppError) {
    const response = NextResponse.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      },
      { status: err.statusCode },
    );
    if (origin) applyCorsHeaders(response, origin);
    return response;
  }

  // Unknown / programmer error — log server-side, return generic message
  if (!isProd) {
    // In development only, surface the raw error for debugging
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: errMsg } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
    { status: 500 },
  );
}

// ─── CORS ────────────────────────────────────────────────────────────────────

/**
 * Applies CORS headers to a response.
 * Call this on every response including error responses.
 */
export function applyCorsHeaders(response: NextResponse, origin: string): NextResponse {
  if (isAllowedOrigin(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}

/**
 * Handles OPTIONS preflight requests.
 * Add this as the OPTIONS export in every API route file.
 */
export function handleOptions(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin') ?? '';
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  const response = new NextResponse(null, { status: 204 });
  return applyCorsHeaders(response, origin);
}
