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

  describe('Emergency & Maintenance Mode Restrictions', () => {
    it('blocks submissions when emergencyMode or submissionsPaused is active', async () => {
      const teamId = 'team-123';
      const roundId = 'round-1';

      // Seed settings with emergencyMode enabled
      await db.collection('settings').doc('platform').set({
        emergencyMode: true,
      });

      // Seed team
      await db.collection('teams').doc(teamId).set({
        status: 'Verified',
        leaderId: 'leader-123',
        leaderEmail: 'leader@test.com',
        leaderPhone: '1112223333',
        college: 'Test College',
        members: [],
      });

      const payload = {
        teamId,
        roundId,
        githubLink: 'https://github.com/my-repo',
        demoLink: 'https://demo.com',
      };

      await expect(submitPayload('leader-123', payload)).rejects.toThrowError(
        /Submissions are currently paused/i
      );
    });

    it('blocks onboarding when registrationsPaused is active', async () => {
      // Seed settings with registrationsPaused enabled
      await db.collection('settings').doc('platform').set({
        registrationsPaused: true,
      });

      const { completeLeaderProfile } = await import('@/server/services/onboarding.service');
      const input = {
        displayName: 'Leader Name',
        role: 'participant_leader',
        phone: '+919999999999',
        college: 'Stanford University',
        github: 'https://github.com/leader',
        whatsapp: '+919999999999',
        course: 'Computer Science',
        gradYear: 2026,
        linkedin: 'https://linkedin.com/in/leader',
        members: [
          {
            name: 'Member Name',
            email: 'member@test.com',
            phone: '9999999991',
            whatsapp: '9999999991',
            college: 'Stanford University',
            course: 'Computer Science',
            gradYear: 2026,
            role: 'Developer',
            github: null,
            linkedin: null,
          }
        ]
      };

      await expect(completeLeaderProfile('user-id-not-existing', input)).rejects.toThrowError(
        /Registrations and onboarding are currently paused/i
      );
    });
  });

  describe('Timeline Automation Scheduler', () => {
    it('auto activates and auto locks rounds on start/deadline times', async () => {
      const roundId1 = 'round-start-test';
      const roundId2 = 'round-deadline-test';

      // 1. Seed Published round whose startsAt is in the past
      await db.collection('rounds').doc(roundId1).set({
        status: 'Published',
        startsAt: new Date(Date.now() - 5000), // in the past
        title: 'Start Round Test',
      });

      // 2. Seed Active round whose submissionDeadline is in the past
      await db.collection('rounds').doc(roundId2).set({
        status: 'Active',
        submissionDeadline: new Date(Date.now() - 5000), // in the past
        title: 'Deadline Round Test',
      });

      // Import handler
      const { POST } = await import('@/app/api/internal/scheduler-worker/route');
      const { NextRequest } = await import('next/server');
      
      const req = new NextRequest('http://localhost/api/internal/scheduler-worker', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      // Verify status changes in DB
      const r1 = await db.collection('rounds').doc(roundId1).get();
      expect(r1.data()?.status).toBe('Active');

      const r2 = await db.collection('rounds').doc(roundId2).get();
      expect(r2.data()?.status).toBe('Locked');
    });
  });
});
