/**
 * Unit tests for withAuth() isActive behaviour.
 *
 * These tests mock the Firebase Admin SDK so they don't need emulators.
 * They specifically verify the Priority-0 bug fix:
 *   - isActive: undefined  → withAuth must NOT throw
 *   - isActive: true       → withAuth must NOT throw
 *   - isActive: false      → withAuth MUST throw 403
 *
 * @module test/withAuth.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Firebase Admin ──────────────────────────────────────────────────────
// We mock at the module level to control what verifyIdToken and Firestore return.

const mockVerifyIdToken = vi.fn();
const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

vi.mock('@/lib/firebase-admin', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
  getAdminDb: () => ({ collection: mockCollection }),
}));

// Import withAuth AFTER mocks are set up
import { withAuth } from '@/lib/api-helpers';
import { AppError } from '@/lib/errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal mock NextRequest with a Bearer token */
function makeRequest(token = 'valid-token') {
  return {
    headers: {
      get: (name: string) => {
        if (name === 'Authorization') return `Bearer ${token}`;
        return null;
      },
    },
  } as any;
}

/** Builds a mock Firestore doc snapshot */
function makeUserSnap(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('withAuth() — isActive field behaviour (Priority 0 bug fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: token verifies successfully
    mockVerifyIdToken.mockResolvedValue({
      uid: 'test-uid-123',
      email: 'test@example.com',
    });
  });

  it('does NOT throw when isActive is undefined (missing field on old docs)', async () => {
    // Simulates a user doc that was created before isActive was added
    mockGet.mockResolvedValue(
      makeUserSnap({ uid: 'test-uid-123', email: 'test@example.com', role: 'participant_leader' })
      // Note: isActive is deliberately absent (undefined)
    );

    const result = await withAuth(makeRequest());

    expect(result.uid).toBe('test-uid-123');
    expect(result.role).toBe('participant_leader');
  });

  it('does NOT throw when isActive is explicitly true', async () => {
    mockGet.mockResolvedValue(
      makeUserSnap({
        uid: 'test-uid-123',
        email: 'test@example.com',
        role: 'participant_leader',
        isActive: true,
      })
    );

    const result = await withAuth(makeRequest());
    expect(result.uid).toBe('test-uid-123');
  });

  it('THROWS 403 when isActive is explicitly false (correctly banned user)', async () => {
    mockGet.mockResolvedValue(
      makeUserSnap({
        uid: 'test-uid-123',
        email: 'test@example.com',
        role: 'participant_leader',
        isActive: false,
      })
    );

    await expect(withAuth(makeRequest())).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('deactivated'),
    });
  });

  it('THROWS 401 when user doc does not exist in Firestore', async () => {
    mockGet.mockResolvedValue(makeUserSnap(null)); // doc doesn't exist

    await expect(withAuth(makeRequest())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('THROWS 401 when Authorization header is missing', async () => {
    const requestNoHeader = {
      headers: { get: () => null },
    } as any;

    await expect(withAuth(requestNoHeader)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('THROWS 401 when token is invalid/expired (Firebase rejects it)', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Firebase: token-expired'));
    mockGet.mockResolvedValue(
      makeUserSnap({ uid: 'x', email: 'x@x.com', role: 'participant_leader', isActive: true })
    );

    await expect(withAuth(makeRequest())).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
