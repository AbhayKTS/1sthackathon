import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAdminDb } from '@/lib/firebase-admin';
import { importInvitations } from '@/server/services/invitation.service';
import { submitPayload } from '@/server/services/submission.service';
import { checkIpRateLimit } from '@/server/services/auth.service';
import { Errors } from '@/lib/errors';

vi.mock('@/server/services/audit.service', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/services/notification.service', () => ({
  createTeamNotification: vi.fn().mockResolvedValue(undefined),
}));

describe('Security Hardening Service Tests', () => {
  const db = getAdminDb();

  beforeEach(async () => {
    // Clear Firestore emulator data
    await fetch(
      'http://127.0.0.1:8080/emulator/v1/projects/demo-revengershack/databases/(default)/documents',
      { method: 'DELETE' }
    );
    vi.clearAllMocks();
  });

  describe('CSV Import Formula Injection', () => {
    it('rejects rows containing formula injection characters', async () => {
      const records = [
        {
          teamName: '=cmd|pipe!A0', // Injection
          leaderName: 'Hacker Leader',
          leaderEmail: 'hacker@test.com',
          leaderPhone: '1234567890',
          college: 'MIT',
        },
        {
          teamName: 'Valid Team',
          leaderName: 'Valid Leader',
          leaderEmail: 'valid@test.com',
          leaderPhone: '0987654321',
          college: '+formula', // Injection
        }
      ];

      const res = await importInvitations(records, 'admin-uid', 'admin', 'batch-1');
      expect(res.failed).toBe(2);
      expect(res.imported).toBe(0);
      expect(res.errors[0]?.reason).toContain('Formula Injection');
      expect(res.errors[1]?.reason).toContain('Formula Injection');
    });
  });

  describe('Submission Locking Immutability', () => {
    it('blocks modification when submission is locked', async () => {
      const teamId = 'team-123';
      const roundId = 'round-1';

      // Seed team
      await db.collection('teams').doc(teamId).set({
        status: 'Verified',
        leaderId: 'leader-123',
        leaderEmail: 'leader@test.com',
        leaderPhone: '1112223333',
        college: 'Test College',
        members: [],
      });

      // Seed active round
      await db.collection('rounds').doc(roundId).set({
        status: 'Active',
        submissionDeadline: new Date(Date.now() + 100000),
        allowedTeams: 'all',
        title: 'Prototype Round',
        type: 'prototype',
      });

      // Seed existing LOCKED submission
      const subId = `${teamId}_${roundId}`;
      await db.collection('submissions').doc(subId).set({
        teamId,
        roundId,
        githubLink: 'https://github.com/original',
        status: 'Locked',
        lockedAt: new Date(),
        submittedBy: 'leader-123',
      });

      const payload = {
        teamId,
        roundId,
        githubLink: 'https://github.com/hacked-overwritten',
        demoLink: 'https://demo.com',
      };

      await expect(submitPayload('leader-123', payload)).rejects.toThrowError(
        /This submission has been locked/i
      );
    });
  });

  describe('IP-Based Rate Limiting', () => {
    it('enforces rolling window request counts per IP', async () => {
      const testIp = '192.168.1.50';

      // Perform 20 requests (maxPerHour is 20)
      for (let i = 0; i < 20; i++) {
        await checkIpRateLimit(testIp);
      }

      // 21st request should trigger Rate Limit error
      await expect(checkIpRateLimit(testIp)).rejects.toThrowError(
        /Too many requests from this IP/i
      );
    });
  });
});
