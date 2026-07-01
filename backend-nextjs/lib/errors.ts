/**
 * Custom error classes for the RevengersHack API.
 *
 * Using typed errors instead of plain Error allows API route handlers
 * to distinguish between operational errors (4xx) and programming errors (5xx)
 * without relying on string matching.
 *
 * @module errors
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_MAX_ATTEMPTS'
  | 'NOT_INVITED'
  | 'ALREADY_VERIFIED'
  | 'DEADLINE_PASSED'
  | 'TEAM_FULL'
  | 'EMAIL_FAILED';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: ErrorCode, isOperational = true) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    // Maintain proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Convenience Factories ────────────────────────────────────────────────────

export const Errors = {
  unauthorized: (msg = 'Authentication required') =>
    new AppError(msg, 401, 'UNAUTHORIZED'),

  forbidden: (msg = 'You do not have permission to perform this action') =>
    new AppError(msg, 403, 'FORBIDDEN'),

  notFound: (resource = 'Resource') =>
    new AppError(`${resource} not found`, 404, 'NOT_FOUND'),

  conflict: (msg: string) =>
    new AppError(msg, 409, 'CONFLICT'),

  validation: (msg: string) =>
    new AppError(msg, 422, 'VALIDATION_ERROR'),

  rateLimited: (msg = 'Too many requests. Please try again later.') =>
    new AppError(msg, 429, 'RATE_LIMITED'),

  internal: (msg = 'An internal error occurred. Please try again.') =>
    new AppError(msg, 500, 'INTERNAL_ERROR', false),

  otpInvalid: () =>
    new AppError('Invalid or expired OTP code.', 400, 'OTP_INVALID'),

  otpExpired: () =>
    new AppError('OTP code has expired. Please request a new one.', 400, 'OTP_EXPIRED'),

  otpMaxAttempts: () =>
    new AppError('Too many incorrect attempts. Please request a new OTP.', 429, 'OTP_MAX_ATTEMPTS'),

  notInvited: () =>
    new AppError(
      'This email was not shortlisted. Only invited teams can access this platform.',
      403,
      'NOT_INVITED',
    ),

  alreadyVerified: () =>
    new AppError('This email has already been verified.', 409, 'ALREADY_VERIFIED'),

  deadlinePassed: () =>
    new AppError('The submission deadline has passed.', 403, 'DEADLINE_PASSED'),

  teamFull: () =>
    new AppError('Team has reached the maximum member limit.', 409, 'TEAM_FULL'),

  emailFailed: () =>
    new AppError('Failed to send email. Please try again.', 503, 'EMAIL_FAILED'),
} as const;
