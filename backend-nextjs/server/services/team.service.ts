/**
 * Team Service — manages team profile submission and updates.
 *
 * @module server/services/team.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import { sendEmail } from './email.service';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TeamMember {
  name: string;
  email: string;
  phone: string;    // Stored with +91 prefix, exactly 10 digits after prefix
  role: string;
  college: string;  // Per-member college (NOT copied from leader)
  github: string | null;
  whatsapp: string;
  course: string;
  gradYear: number;
  linkedin: string | null;
}

export interface TeamProfileInput {
  teamName: string;
  college: string;       // Leader's college (team-level field)
  department: string;
  year: string;
  state: string;
  city: string;
  leaderName: string;
  leaderPhone: string;
  leaderGithub: string | null;
  leaderLinkedin: string | null;
  leaderWhatsapp: string;
  leaderCourse: string;
  leaderGradYear: number;
  track: string;
  problemStatement: string;
  isCustomPS: boolean;
  members: TeamMember[]; // Leader is index 0; total 2–4 (leader + 1-3 others)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalises a phone string to exactly "+91XXXXXXXXXX".
 * Strips any existing +91 / 91 prefix, then validates 10 digits remain.
 * Throws Errors.validation() if invalid.
 */
function normalisePhone(raw: string, label = 'Phone'): string {
  // Strip whitespace / dashes / dots
  let digits = raw.replace(/[\s\-\.]/g, '');

  // Strip country code prefix variations
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);

  if (!/^\d{10}$/.test(digits)) {
    throw Errors.validation(`${label} must be exactly 10 digits (we'll prefix +91 automatically). Got: "${raw}"`);
  }

  return `+91${digits}`;
}

/**
 * Checks for duplicate emails and phones across the entire team (leader + members).
 * Throws Errors.validation() if any duplicates found.
 */
function checkNoDuplicates(members: TeamMember[]): void {
  const emails = members.map(m => m.email.toLowerCase().trim());
  const phones = members.map(m => m.phone.trim());

  const emailSet = new Set<string>();
  for (const email of emails) {
    if (emailSet.has(email)) {
      throw Errors.validation(`Duplicate email detected: "${email}". Each team member must have a unique email.`);
    }
    emailSet.add(email);
  }

  const phoneSet = new Set<string>();
  for (const phone of phones) {
    // Normalise for comparison (strip +91 prefix)
    const digits = phone.replace(/^\+91/, '');
    if (phoneSet.has(digits)) {
      throw Errors.validation(`Duplicate phone number detected. Each team member must have a unique phone number.`);
    }
    phoneSet.add(digits);
  }
}

// ─── Submit / Upsert ──────────────────────────────────────────────────────────

/**
 * Submits or updates the team profile.
 * Only the participant_leader can perform this action.
 *
 * Validates:
 *  - Team size: 2–4 members total (leader is members[0])
 *  - Phone: 10 digits, auto-prefixed with +91
 *  - No duplicate email or phone within the team
 *
 * After successful first-time creation, emails all non-leader members.
 */
export async function submitTeamProfile(
  uid: string,
  invitedTeamId: string,
  input: TeamProfileInput
): Promise<string> {
  const db = getAdminDb();

  // ─── Validation ───────────────────────────────────────────────────────────

  if (!input.members || input.members.length < 2 || input.members.length > 4) {
    throw Errors.validation('A team must have between 2 and 4 members total (leader + 1 to 3 others).');
  }

  // Normalise and validate all phones
  const normalisedMembers: TeamMember[] = input.members.map((m, i) => ({
    ...m,
    phone: normalisePhone(m.phone, i === 0 ? 'Leader phone' : `Member ${i + 1} phone`),
    email: m.email.toLowerCase().trim(),
    college: m.college.trim(),
    github: m.github?.trim() || null,
  }));

  // Leader-level phone
  const normalisedLeaderPhone = normalisePhone(input.leaderPhone, 'Leader phone');

  // Duplicate check across all member emails and phones
  checkNoDuplicates(normalisedMembers);

  // ─── Transaction ─────────────────────────────────────────────────────────

  const teamId = await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) {
      throw Errors.unauthorized('User record not found.');
    }

    const userData = userSnap.data()!;
    let currentTeamId = userData['teamId'] as string | null;

    let teamRef;
    if (currentTeamId) {
      teamRef = db.collection('teams').doc(currentTeamId);
    } else {
      teamRef = db.collection('teams').doc();
      currentTeamId = teamRef.id;
    }

    const teamData = {
      // Identity
      teamName: input.teamName.trim(),
      invitedTeamId,

      // Team-level info
      college: input.college.trim(),
      department: input.department?.trim() || '',
      year: input.year?.trim() || '',
      state: input.state?.trim() || '',
      city: input.city?.trim() || '',

      // Track + PS
      track: input.track.trim(),
      problemStatement: input.problemStatement.trim(),
      isCustomPS: input.isCustomPS,

      // Leader (denormalized)
      leaderId: uid,
      leaderName: input.leaderName.trim(),
      leaderEmail: normalisedMembers[0]!.email,
      leaderPhone: normalisedLeaderPhone,
      leaderGithub: input.leaderGithub?.trim() || null,
      leaderLinkedin: input.leaderLinkedin?.trim() || null,

      // Members array (all members including leader at index 0)
      members: normalisedMembers,
      memberEmails: normalisedMembers.map((m) => m.email),

      status: 'Submitted',
      updatedAt: FieldValue.serverTimestamp(),
    };

    const isFirstSubmission = !userData['teamId'];

    if (isFirstSubmission) {
      tx.set(teamRef, {
        ...teamData,
        scores: [],
        needChangesHistory: [],
        adminNotes: null,
        resumeStoragePath: null,
        photoStoragePath: null,
        idStoragePath: null,
        createdAt: FieldValue.serverTimestamp(),
        submittedAt: FieldValue.serverTimestamp(),
        approvedAt: null,
        rejectedAt: null,
        // Stage 6e flags
        isTimeLeapSelected: false,
        isTop10: false,
        isTop15: false,
      });
      tx.update(userRef, {
        teamId: currentTeamId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(teamRef, teamData, { merge: true });
    }

    if (invitedTeamId) {
      const inviteRef = db.collection('invitedTeams').doc(invitedTeamId);
      tx.update(inviteRef, { status: 'Submitted', updatedAt: FieldValue.serverTimestamp() });
    }

    return currentTeamId;
  });

  // ─── Audit Log ────────────────────────────────────────────────────────────
  await writeAuditLog({
    action: 'team.profile_submitted',
    actorUid: uid,
    actorRole: 'participant_leader',
    targetId: teamId,
    targetType: 'teams',
    metadata: {
      teamName: input.teamName,
      memberCount: input.members.length,
      track: input.track,
    },
    ip: null,
  });

  // ─── Member Notification Emails ───────────────────────────────────────────
  // Only on first submission. Non-leader members get an email so they know
  // they can now log in via OTP.
  const baseUrl =
    process.env.NODE_ENV === 'production'
      ? 'https://revengershack.tech'
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173';
  const loginUrl = `${baseUrl}/login`;

  const nonLeaderMembers = normalisedMembers.slice(1); // leader is index 0
  await Promise.allSettled(
    nonLeaderMembers.map((member) =>
      sendEmail({
        to: member.email,
        template: 'memberInvited',
        variables: {
          memberName: member.name,
          teamName: input.teamName,
          leaderName: input.leaderName,
          loginUrl,
        },
      }).catch((e) => console.error(`[team.service] Failed to send memberInvited to ${member.email}:`, e))
    )
  );

  return teamId;
}

// ─── Update (NeedChanges re-submission) ───────────────────────────────────────

/**
 * Updates an existing team profile.
 * Only allowed when team status is 'Incomplete' (i.e., admin requested changes).
 */
export async function updateTeamDetails(
  uid: string,
  input: Partial<TeamProfileInput>
): Promise<void> {
  const db = getAdminDb();

  if (input.members && (input.members.length < 2 || input.members.length > 4)) {
    throw Errors.validation('A team must have between 2 and 4 members total.');
  }

  // Normalise + validate phones if members provided
  let normalisedMembers: TeamMember[] | undefined;
  let normalisedLeaderPhone: string | undefined;

  if (input.members) {
    normalisedMembers = input.members.map((m, i) => ({
      ...m,
      phone: normalisePhone(m.phone, i === 0 ? 'Leader phone' : `Member ${i + 1} phone`),
      email: m.email.toLowerCase().trim(),
      college: m.college.trim(),
      github: m.github?.trim() || null,
    }));
    checkNoDuplicates(normalisedMembers);
  }

  if (input.leaderPhone) {
    normalisedLeaderPhone = normalisePhone(input.leaderPhone, 'Leader phone');
  }

  await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) throw Errors.unauthorized('User record not found.');

    const userData = userSnap.data()!;
    const currentTeamId = userData['teamId'] as string | null;

    if (!currentTeamId) throw Errors.validation('No team profile found to update.');

    const teamRef = db.collection('teams').doc(currentTeamId);
    const teamSnap = await tx.get(teamRef);

    if (!teamSnap.exists) throw Errors.notFound('Team not found.');

    const teamData = teamSnap.data()!;

    if (teamData['leaderId'] !== uid) {
      throw Errors.forbidden('Only the team leader can update the profile.');
    }

    if (
      teamData['status'] === 'Submitted' ||
      teamData['status'] === 'Approved' ||
      teamData['status'] === 'Rejected'
    ) {
      throw Errors.forbidden(`Team profile is locked because it is currently '${teamData['status']}'.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic update object
    const updateData: any = { updatedAt: FieldValue.serverTimestamp(), status: 'Submitted' };

    if (input.teamName) updateData.teamName = input.teamName.trim();
    if (input.college) updateData.college = input.college.trim();
    if (input.department !== undefined) updateData.department = input.department.trim();
    if (input.year !== undefined) updateData.year = input.year.trim();
    if (input.state !== undefined) updateData.state = input.state.trim();
    if (input.city !== undefined) updateData.city = input.city.trim();
    if (input.track !== undefined) updateData.track = input.track.trim();
    if (input.problemStatement !== undefined) updateData.problemStatement = input.problemStatement.trim();
    if (input.isCustomPS !== undefined) updateData.isCustomPS = input.isCustomPS;
    if (input.leaderName !== undefined) updateData.leaderName = input.leaderName.trim();
    if (normalisedLeaderPhone) updateData.leaderPhone = normalisedLeaderPhone;
    if (input.leaderGithub !== undefined) updateData.leaderGithub = input.leaderGithub?.trim() || null;
    if (input.leaderLinkedin !== undefined) updateData.leaderLinkedin = input.leaderLinkedin?.trim() || null;
    if (normalisedMembers) {
      updateData.members = normalisedMembers;
      updateData.memberEmails = normalisedMembers.map((m) => m.email);
    }

    tx.update(teamRef, updateData);

    if (teamData['invitedTeamId']) {
      const inviteRef = db.collection('invitedTeams').doc(teamData['invitedTeamId']);
      tx.update(inviteRef, { status: 'Submitted', updatedAt: FieldValue.serverTimestamp() });
    }
  });

  const userSnap = await db.collection('users').doc(uid).get();
  const teamId = userSnap.data()?.['teamId'];

  await writeAuditLog({
    action: 'team.updated',
    actorUid: uid,
    actorRole: 'participant_leader',
    targetId: teamId,
    targetType: 'teams',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}

// ─── Admin Flags ──────────────────────────────────────────────────────────────

/**
 * Admin-only: set isTimeLeapSelected flag on a team.
 */
export async function setTimeLeapSelected(
  adminUid: string,
  teamId: string,
  value: boolean,
): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (!snap.exists) throw Errors.notFound('Team not found.');

  await teamRef.update({ isTimeLeapSelected: value, updatedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: 'team.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: teamId,
    targetType: 'teams',
    metadata: { field: 'isTimeLeapSelected', value },
    ip: null,
  });
}

/**
 * Admin-only: set isTop10 / isTop15 flags on a team.
 */
export async function setTopFlags(
  adminUid: string,
  teamId: string,
  flags: { isTop10?: boolean; isTop15?: boolean },
): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (!snap.exists) throw Errors.notFound('Team not found.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { updatedAt: FieldValue.serverTimestamp() };
  if (flags.isTop10 !== undefined) update.isTop10 = flags.isTop10;
  if (flags.isTop15 !== undefined) update.isTop15 = flags.isTop15;

  await teamRef.update(update);

  await writeAuditLog({
    action: 'team.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: teamId,
    targetType: 'teams',
    metadata: { flags },
    ip: null,
  });
}
