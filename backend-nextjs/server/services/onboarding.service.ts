/**
 * Onboarding Service — Admin-driven registration flow.
 *
 * Flow:
 *   1. Admin imports invitedTeams (via import-teams API)
 *   2. Admin sends leader invitation (triggers mailQueue job)
 *   3. Leader completes profile → invitedTeams status: LeaderRegistered
 *   4. System auto-invites members (mailQueue jobs)
 *   5. Each member completes profile → when ALL done → registrationLocked
 *
 * Rules:
 *   - Team size: 2–4 members total
 *   - Phone: Indian (+91, exactly 10 digits after prefix)
 *   - Each member edits ONLY their own profile after initial setup
 *   - Once locked, registration is permanent and immutable
 *
 * @module server/services/onboarding.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import { createMailJobs } from './mail-queue.service';
import { getPortalBaseUrl } from '@/lib/env';
import type { UserRole, InvitedTeamStatus } from '@/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingProfileInput {
  displayName: string;
  role: string;        // e.g., "Frontend Developer", "ML Engineer"
  phone: string;       // Will be normalised to +91XXXXXXXXXX
  college: string;
  github: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalises a phone string to exactly "+91XXXXXXXXXX".
 * Strips whitespace/dashes/dots. Auto-adds +91 prefix.
 */
export function normalisePhone(raw: string, label = 'Phone'): string {
  let digits = raw.replace(/[\s\-\.]/g, '');

  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);

  if (!/^\d{10}$/.test(digits)) {
    throw Errors.validation(
      `${label} must be exactly 10 digits (we auto-prefix +91). Got: "${raw}"`
    );
  }

  return `+91${digits}`;
}

// ─── Leader Onboarding ────────────────────────────────────────────────────────

/**
 * Called when the Team Leader completes their profile.
 *
 * 1. Updates the Users/{uid} document with profile data
 * 2. Creates/updates Teams/{teamId} with leader info
 * 3. Updates InvitedTeams status to LeaderRegistered
 * 4. Queues member invitation emails
 */
async function assertRegistrationsNotPaused(db: FirebaseFirestore.Firestore) {
  const settingsSnap = await db.collection('settings').doc('platform').get();
  if (settingsSnap.exists) {
    const data = settingsSnap.data()!;
    if (data['maintenanceMode'] === true || data['emergencyMode'] === true || data['registrationsPaused'] === true) {
      throw Errors.forbidden('Registrations and onboarding are currently paused by the system administrator.');
    }
  }
}

export async function completeLeaderProfile(
  uid: string,
  input: OnboardingProfileInput,
): Promise<void> {
  const db = getAdminDb();
  await assertRegistrationsNotPaused(db);

  // 1. Validate phone
  const normalisedPhone = normalisePhone(input.phone, 'Mobile number');

  // 2. Load user doc
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw Errors.unauthorized('User record not found.');

  const userData = userSnap.data()!;
  if (userData['role'] !== 'participant_leader') {
    throw Errors.forbidden('Only a team leader can complete the leader profile.');
  }

  const invitedTeamId = userData['invitedTeamId'] as string | null;
  if (!invitedTeamId) {
    throw Errors.validation('No invited team associated with this account.');
  }

  // 3. Load invited team
  const inviteRef = db.collection('invitedTeams').doc(invitedTeamId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw Errors.notFound('Invited team record');

  const inviteData = inviteSnap.data()!;
  const currentStatus = inviteData['status'] as InvitedTeamStatus;

  if (currentStatus === 'Locked') {
    throw Errors.forbidden('Registration is permanently locked and cannot be modified.');
  }

  // 4. Check if a Teams doc already exists for this invite
  const teamSnap = await db
    .collection('teams')
    .where('invitedTeamId', '==', invitedTeamId)
    .limit(1)
    .get();

  const isFirstSubmission = teamSnap.empty;

  await db.runTransaction(async (tx) => {
    // Update Users doc
    tx.update(userRef, {
      displayName: input.displayName.trim(),
      phone: normalisedPhone,
      college: input.college.trim(),
      github: input.github?.trim() || null,
      onboardingStatus: 'complete',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Build initial members array from invitedTeams.members
    const prePopulatedMembers = (inviteData['members'] || []) as Array<{
      name: string; email: string; role: string; college: string;
    }>;

    const membersArray = prePopulatedMembers.map((m) => ({
      uid: null,
      name: m.name,
      email: m.email.toLowerCase(),
      phone: '',
      role: m.role,
      college: m.college,
      github: null,
      onboardingComplete: false,
      joinedAt: null,
    }));

    const teamData = {
      teamName: inviteData['teamName'] as string,
      invitedTeamId,
      domain: inviteData['domain'] as string || '',
      problemStatement: inviteData['problemStatement'] as string || '',
      isCustomPS: inviteData['isCustomPS'] as boolean || false,
      leaderId: uid,
      leaderName: input.displayName.trim(),
      leaderEmail: userData['email'] as string,
      leaderPhone: normalisedPhone,
      leaderGithub: input.github?.trim() || null,
      leaderCollege: input.college.trim(),
      members: membersArray,
      memberEmails: membersArray.map((m) => m.email),
      status: 'Draft',
      registrationLocked: false,
      adminNotes: null,
      isTimeLeapEligible: false,
      isTimeLeapQualified: false,
      isFinalist: false,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (isFirstSubmission) {
      const teamRef = db.collection('teams').doc();
      tx.set(teamRef, {
        ...teamData,
        createdAt: FieldValue.serverTimestamp(),
        verifiedAt: null,
        registrationLockedAt: null,
      });

      // Link user to team
      tx.update(userRef, { teamId: teamRef.id });
    } else {
      // Update existing team doc
      const existingTeamRef = teamSnap.docs[0]!.ref;
      tx.update(existingTeamRef, teamData);
    }

    // Update invited team status
    tx.update(inviteRef, {
      status: 'LeaderRegistered' as InvitedTeamStatus,
      leaderRegisteredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // 5. Audit log
  await writeAuditLog({
    action: 'team.leader_registered',
    actorUid: uid,
    actorRole: 'participant_leader',
    targetId: invitedTeamId,
    targetType: 'invitedTeams',
    metadata: { invitedTeamId },
    ip: null,
  });

  // 6. Queue member invitation emails (only on first submission)
  if (isFirstSubmission) {
    const prePopulatedMembers = (inviteData['members'] || []) as Array<{
      name: string; email: string; role: string; college: string;
    }>;

    const loginUrl = `${getPortalBaseUrl()}/login`;
    const memberEmailJobs = prePopulatedMembers.map((m) => ({
      to: m.email,
      template: 'member_invitation' as const,
      variables: {
        memberName: m.name,
        teamName: inviteData['teamName'] as string,
        leaderName: input.displayName.trim(),
        loginUrl,
      },
      priority: 'high' as const,
      createdBy: uid,
    }));

    if (memberEmailJobs.length > 0) {
      await createMailJobs(memberEmailJobs);

      // Update invitedTeams status to MembersInvited
      await db.collection('invitedTeams').doc(invitedTeamId).update({
        status: 'MembersInvited' as InvitedTeamStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeAuditLog({
        action: 'team.members_invited',
        actorUid: uid,
        actorRole: 'participant_leader',
        targetId: invitedTeamId,
        targetType: 'invitedTeams',
        metadata: { memberCount: memberEmailJobs.length },
        ip: null,
      });
    }
  }
}

// ─── Member Onboarding ────────────────────────────────────────────────────────

/**
 * Called when a team Member completes their profile.
 *
 * 1. Updates Users/{uid} with profile data
 * 2. Updates their slot in Teams/{teamId}.members array
 * 3. If ALL members complete → locks registration permanently
 */
export async function completeMemberProfile(
  uid: string,
  input: OnboardingProfileInput,
): Promise<void> {
  const db = getAdminDb();
  await assertRegistrationsNotPaused(db);

  const normalisedPhone = normalisePhone(input.phone, 'Mobile number');

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw Errors.unauthorized('User record not found.');

  const userData = userSnap.data()!;
  const memberEmail = (userData['email'] as string).toLowerCase();

  // Find the team this member belongs to
  const teamSnap = await db
    .collection('teams')
    .where('memberEmails', 'array-contains', memberEmail)
    .limit(1)
    .get();

  if (teamSnap.empty) {
    throw Errors.validation('No team found for this member email.');
  }

  const teamDoc = teamSnap.docs[0]!;
  const teamData = teamDoc.data();

  if (teamData['registrationLocked']) {
    throw Errors.forbidden('Registration is permanently locked and cannot be modified.');
  }

  // Update the member's entry in the members array
  const updatedMembers = (teamData['members'] as Array<Record<string, unknown>>).map((m) => {
    if ((m['email'] as string).toLowerCase() === memberEmail) {
      return {
        ...m,
        uid,
        name: input.displayName.trim(),
        phone: normalisedPhone,
        role: input.role.trim(),
        college: input.college.trim(),
        github: input.github?.trim() || null,
        onboardingComplete: true,
        joinedAt: new Date(),
      };
    }
    return m;
  });

  // Check if all members have completed onboarding
  const allComplete = updatedMembers.every((m) => m['onboardingComplete'] === true);

  await db.runTransaction(async (tx) => {
    // Update user profile
    tx.update(userRef, {
      displayName: input.displayName.trim(),
      phone: normalisedPhone,
      college: input.college.trim(),
      github: input.github?.trim() || null,
      onboardingStatus: 'complete',
      teamId: teamDoc.id,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update team members array
    const teamUpdate: Record<string, unknown> = {
      members: updatedMembers,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (allComplete) {
      teamUpdate['registrationLocked'] = true;
      teamUpdate['registrationLockedAt'] = FieldValue.serverTimestamp();
      teamUpdate['status'] = 'Verified';
    }

    tx.update(teamDoc.ref, teamUpdate);

    // Update invitedTeams if all complete
    if (allComplete && teamData['invitedTeamId']) {
      const inviteRef = db.collection('invitedTeams').doc(teamData['invitedTeamId'] as string);
      tx.update(inviteRef, {
        status: 'Verified' as InvitedTeamStatus,
        allMembersRegisteredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    action: 'team.member_registered',
    actorUid: uid,
    actorRole: 'participant_member',
    targetId: teamDoc.id,
    targetType: 'teams',
    metadata: { email: memberEmail, allComplete },
    ip: null,
  });

  if (allComplete) {
    await writeAuditLog({
      action: 'team.registration_locked',
      actorUid: 'system',
      actorRole: 'system',
      targetId: teamDoc.id,
      targetType: 'teams',
      metadata: { lockedBy: 'auto_all_members_complete' },
      ip: null,
    });
  }
}

/**
 * Allows a member to update ONLY their own profile fields.
 * Cannot change email. Cannot unlock a locked registration.
 */
export async function updateMemberProfile(
  uid: string,
  input: Partial<OnboardingProfileInput>,
): Promise<void> {
  const db = getAdminDb();

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw Errors.unauthorized('User record not found.');

  const userData = userSnap.data()!;
  const memberEmail = (userData['email'] as string).toLowerCase();
  const userRole = userData['role'] as UserRole;

  if (!['participant_leader', 'participant_member'].includes(userRole)) {
    throw Errors.forbidden('Only participants can update their own profile.');
  }

  const normalisedPhone = input.phone ? normalisePhone(input.phone, 'Mobile number') : undefined;

  // Update user doc
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userUpdate: any = { updatedAt: FieldValue.serverTimestamp() };
  if (input.displayName) userUpdate.displayName = input.displayName.trim();
  if (normalisedPhone) userUpdate.phone = normalisedPhone;
  if (input.college) userUpdate.college = input.college.trim();
  if (input.github !== undefined) userUpdate.github = input.github?.trim() || null;
  if (input.role) userUpdate.role = input.role.trim();  // role in context of team, not system role

  await userRef.update(userUpdate);

  // Update the corresponding member entry in the team doc
  const teamId = userData['teamId'] as string | null;
  if (teamId) {
    const teamRef = db.collection('teams').doc(teamId);
    const teamSnap = await teamRef.get();

    if (teamSnap.exists) {
      const teamData = teamSnap.data()!;

      if (teamData['registrationLocked']) {
        throw Errors.forbidden('Registration is permanently locked. Profile updates are not allowed.');
      }

      const isLeader = teamData['leaderId'] === uid;

      if (isLeader) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const leaderUpdate: any = { updatedAt: FieldValue.serverTimestamp() };
        if (input.displayName) leaderUpdate.leaderName = input.displayName.trim();
        if (normalisedPhone) leaderUpdate.leaderPhone = normalisedPhone;
        if (input.college) leaderUpdate.leaderCollege = input.college.trim();
        if (input.github !== undefined) leaderUpdate.leaderGithub = input.github?.trim() || null;
        await teamRef.update(leaderUpdate);
      } else {
        // Update member entry in the array
        const updatedMembers = (teamData['members'] as Array<Record<string, unknown>>).map((m) => {
          if ((m['email'] as string).toLowerCase() === memberEmail) {
            return {
              ...m,
              ...(input.displayName && { name: input.displayName.trim() }),
              ...(normalisedPhone && { phone: normalisedPhone }),
              ...(input.role && { role: input.role.trim() }),
              ...(input.college && { college: input.college.trim() }),
              ...(input.github !== undefined && { github: input.github?.trim() || null }),
            };
          }
          return m;
        });
        await teamRef.update({ members: updatedMembers, updatedAt: FieldValue.serverTimestamp() });
      }
    }
  }

  await writeAuditLog({
    action: 'team.updated',
    actorUid: uid,
    actorRole: userRole,
    targetId: teamId,
    targetType: 'teams',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}
