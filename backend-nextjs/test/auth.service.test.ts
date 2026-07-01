import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import {
  checkInviteStatus,
  checkAndIncrementRateLimit,
  generateAndStoreOtp,
  verifyOtpAndCreateSession,
} from '@/server/services/auth.service';
import { Errors } from '@/lib/errors';
import * as auditService from '@/server/services/audit.service';
import crypto from 'crypto';

// Mock the audit service so we don't need to test its side-effects here
vi.mock('@/server/services/audit.service', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

describe('Auth Service (Phase 1 OTP)', () => {
  const db = getAdminDb();
  const auth = getAdminAuth();
  const testEmail = 'leader@test.com';

  beforeEach(async () => {
    // Clear Firestore emulator data
    await fetch(
      'http://127.0.0.1:8080/emulator/v1/projects/demo-revengershack/databases/(default)/documents',
      { method: 'DELETE' }
    );
    // Note: Admin SDK doesn't easily clear Auth users via HTTP, 
    // but in these tests we mostly care about Firestore docs and specific Auth interactions.
    vi.clearAllMocks();
  });

  describe('checkInviteStatus', () => {
    it('throws NOT_INVITED if email is not in invitedTeams', async () => {
      await expect(checkInviteStatus('nobody@test.com')).rejects.toThrowError(
        Errors.notInvited().message
      );
    });

    it('throws FORBIDDEN if invite is Expired', async () => {
      await db.collection('invitedTeams').add({
        leaderEmail: testEmail,
        status: 'Expired',
        teamName: 'Test Team',
      });

      await expect(checkInviteStatus(testEmail)).rejects.toThrowError(/expired/i);
    });

    it('returns invite record if valid', async () => {
      const doc = await db.collection('invitedTeams').add({
        leaderEmail: testEmail,
        status: 'Invited',
        teamName: 'Test Team',
        leaderName: 'Test Leader',
      });

      const invite = await checkInviteStatus(testEmail);
      expect(invite.id).toBe(doc.id);
      expect(invite.teamName).toBe('Test Team');
    });
  });

  describe('checkAndIncrementRateLimit', () => {
    it('allows requests within limit', async () => {
      // First request should succeed
      await expect(checkAndIncrementRateLimit(testEmail)).resolves.toBeUndefined();
      
      const doc = await db.collection('otpRateLimits').doc(encodeURIComponent(testEmail)).get();
      expect(doc.data()?.count).toBe(1);
    });

    it('throws RATE_LIMITED when exceeding max requests', async () => {
      const docId = encodeURIComponent(testEmail);
      
      // Simulate 5 existing requests (default max)
      await db.collection('otpRateLimits').doc(docId).set({
        email: testEmail,
        count: 5,
        windowStart: new Date(),
        lastRequest: new Date(),
      });

      await expect(checkAndIncrementRateLimit(testEmail)).rejects.toThrowError(/Too many OTP requests/i);
    });
  });

  describe('generateAndStoreOtp', () => {
    it('generates a 6-digit OTP and stores its hash', async () => {
      const { otp, docId } = await generateAndStoreOtp(testEmail);
      
      expect(otp).toMatch(/^\d{6}$/);

      const doc = await db.collection('otpCodes').doc(docId).get();
      expect(doc.exists).toBe(true);
      
      const data = doc.data()!;
      expect(data.email).toBe(testEmail);
      expect(data.used).toBe(false);
      expect(data.attempts).toBe(0);
      expect(data.codeHash).toBeDefined();
    });
  });

  describe('verifyOtpAndCreateSession', () => {
    let inviteId: string;
    let plainOtp: string;

    beforeEach(async () => {
      // 1. Setup an invited team
      const inviteRef = await db.collection('invitedTeams').add({
        leaderEmail: testEmail,
        status: 'Invited',
        teamName: 'Test Team',
      });
      inviteId = inviteRef.id;

      // 2. Generate a valid OTP
      const generated = await generateAndStoreOtp(testEmail);
      plainOtp = generated.otp;
    });

    it('throws NOT_INVITED if invite is missing during verification', async () => {
      // Delete invite to simulate it being removed before they verify
      await db.collection('invitedTeams').doc(inviteId).delete();
      await expect(verifyOtpAndCreateSession(testEmail, plainOtp)).rejects.toThrowError(
        Errors.notInvited().message
      );
    });

    it('throws OTP_INVALID for incorrect OTP', async () => {
      await expect(verifyOtpAndCreateSession(testEmail, '000000')).rejects.toThrowError(/Incorrect OTP code/i);
      
      // Check attempts incremented
      const otps = await db.collection('otpCodes').where('email', '==', testEmail).get();
      expect(otps.docs[0].data().attempts).toBe(1);
    });

    it('successfully verifies, creates user, and issues custom token', async () => {
      const result = await verifyOtpAndCreateSession(testEmail, plainOtp);
      
      expect(result.email).toBe(testEmail);
      expect(result.role).toBe('participant_leader');
      expect(result.isNewUser).toBe(true);
      expect(typeof result.customToken).toBe('string');
      expect(result.invitedTeamId).toBe(inviteId);

      // Verify OTP is marked used
      const otps = await db.collection('otpCodes').where('email', '==', testEmail).get();
      expect(otps.docs[0].data().used).toBe(true);

      // Verify Users doc is created
      const userDoc = await db.collection('users').doc(result.uid).get();
      expect(userDoc.exists).toBe(true);
      expect(userDoc.data()?.role).toBe('participant_leader');
      expect(userDoc.data()?.invitedTeamId).toBe(inviteId);

      // Verify Invite status is updated
      const inviteDoc = await db.collection('invitedTeams').doc(inviteId).get();
      expect(inviteDoc.data()?.status).toBe('Verified');
      
      // Verify audit log was called
      expect(auditService.writeAuditLog).toHaveBeenCalled();
    });

    it('throws OTP_INVALID if OTP is already used', async () => {
      // First verification succeeds
      await verifyOtpAndCreateSession(testEmail, plainOtp);
      
      // Second verification fails
      await expect(verifyOtpAndCreateSession(testEmail, plainOtp)).rejects.toThrowError(
        Errors.otpInvalid().message
      );
    });
  });
});
