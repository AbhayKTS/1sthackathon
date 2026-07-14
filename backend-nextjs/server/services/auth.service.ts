/**
 * Auth Service — OTP issuance, verification, user creation.
 *
 * Framework-agnostic — no Next.js imports. Can be lifted into a Cloud Function
 * by only replacing the calling wrapper (see D-001 in DECISIONS.md).
 *
 * Collections used (server-side Admin SDK only):
 *   - otpCodes       — stores hashed OTP codes with expiry
 *   - otpRateLimits  — rate limit counters per email
 *   - invitedTeams   — checked to gate OTP issuance
 *   - users          — created/updated on successful verification
 *
 * @module server/services/auth.service
 */

import { createHash, randomInt } from 'crypto';
import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { env } from '@/lib/env';
import { writeAuditLog } from './audit.service';
import type { UserRole } from '@/types/auth';
import { sendEmail } from './email.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cryptographically secure 6-digit OTP */
function generateOtp(): string {
  // randomInt(min, max) is exclusive on max, so 100000–999999 inclusive
  return String(randomInt(100000, 1000000));
}

/**
 * Hashes an OTP with a project-specific pepper.
 * Prevents rainbow-table attacks on the stored OtpCodes collection.
 */
function hashOtp(otp: string): string {
  // Use projectId as pepper — always available, no extra env var needed
  const pepper = `rh:${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'dev'}`;
  return createHash('sha256').update(`${otp}:${pepper}`).digest('hex');
}

// ─── Invite Check ─────────────────────────────────────────────────────────────

export interface InviteRecord {
  id: string;
  teamName: string;
  leaderName: string;
  status: string;
}

/**
 * Verifies that an email exists in the `invitedTeams` collection.
 * Throws NOT_INVITED if the email is not shortlisted.
 * Throws FORBIDDEN if the invitation has expired.
 */
export async function checkInviteStatus(email: string): Promise<InviteRecord> {
  const db = getAdminDb();
  const normalizedEmail = email.toLowerCase();

  // Option B: Check if the user is an admin/super_admin to bypass whitelist
  const userSnap = await db
    .collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (!userSnap.empty) {
    const userData = userSnap.docs[0]!.data();
    if (userData['role'] === 'admin' || userData['role'] === 'super_admin') {
      return {
        id: `admin-${userSnap.docs[0]!.id}`,
        teamName: 'System Administration',
        leaderName: 'Admin',
        status: 'Verified',
      };
    }
  }

  const snap = await db
    .collection('invitedTeams')
    .where('leaderEmail', '==', normalizedEmail)
    .limit(1)
    .get();

  if (snap.empty) {
    // Check if the email belongs to a member of a team
    const teamSnap = await db
      .collection('teams')
      .where('memberEmails', 'array-contains', normalizedEmail)
      .limit(1)
      .get();

    if (teamSnap.empty) {
      throw Errors.notInvited();
    }

    const teamDoc = teamSnap.docs[0]!;
    const teamData = teamDoc.data();

    if (teamData.status === 'Rejected') {
      throw Errors.forbidden('Your team application has been rejected.');
    }

    const member = (teamData.members || []).find(
      (m: any) => (m.email || '').toLowerCase() === normalizedEmail
    );

    return {
      id: `member-${teamDoc.id}-${normalizedEmail}`,
      teamName: teamData.teamName as string,
      leaderName: member ? (member.name as string) : 'Team Member',
      status: teamData.status as string,
    };
  }

  const doc = snap.docs[0]!;
  const data = doc.data();

  if (data['status'] === 'Expired') {
    throw Errors.forbidden(
      'Your invitation has expired. Please contact the organizers.',
    );
  }

  return {
    id: doc.id,
    teamName: data['teamName'] as string,
    leaderName: data['leaderName'] as string,
    status: data['status'] as string,
  };
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────────

/**
 * Checks and atomically increments the OTP request rate limit for an email.
 * Uses a Firestore transaction on the `otpRateLimits` collection.
 *
 * Allows max `OTP_MAX_PER_HOUR` requests per rolling 1-hour window.
 * Throws RATE_LIMITED if the limit is exceeded.
 */
export async function checkAndIncrementRateLimit(email: string): Promise<void> {
  const db = getAdminDb();
  // Use URL-encoded email as doc ID for safe Firestore path
  const docId = encodeURIComponent(email.toLowerCase());
  const ref = db.collection('otpRateLimits').doc(docId);

  const maxPerHour = env.OTP_MAX_PER_HOUR ?? 5;
  const windowMs = 60 * 60 * 1000; // 1 hour

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    if (!snap.exists) {
      tx.set(ref, {
        email: email.toLowerCase(),
        count: 1,
        windowStart: FieldValue.serverTimestamp(),
        lastRequest: FieldValue.serverTimestamp(),
      });
      return;
    }

    const data = snap.data()!;
    const windowStartMs = (data['windowStart'] as Timestamp).toMillis();

    if (now - windowStartMs > windowMs) {
      // Rolling window expired — reset counter
      tx.set(ref, {
        email: email.toLowerCase(),
        count: 1,
        windowStart: FieldValue.serverTimestamp(),
        lastRequest: FieldValue.serverTimestamp(),
      });
      return;
    }

    const currentCount = data['count'] as number;
    if (currentCount >= maxPerHour) {
      const resetInMs = windowMs - (now - windowStartMs);
      const resetInMins = Math.ceil(resetInMs / 60000);
      throw Errors.rateLimited(
        `Too many OTP requests. Try again in ${resetInMins} minute${resetInMins !== 1 ? 's' : ''}.`,
      );
    }

    tx.update(ref, {
      count: FieldValue.increment(1),
      lastRequest: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Checks and atomically increments the request rate limit for an IP address.
 * Allows max 20 requests per rolling 1-hour window.
 */
export async function checkIpRateLimit(ip: string): Promise<void> {
  const db = getAdminDb();
  const docId = `ip_${encodeURIComponent(ip)}`;
  const ref = db.collection('otpRateLimits').doc(docId);
  const maxPerHour = 20; // 20 requests per hour per IP
  const windowMs = 60 * 60 * 1000; // 1 hour

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    if (!snap.exists) {
      tx.set(ref, {
        ip,
        count: 1,
        windowStart: FieldValue.serverTimestamp(),
        lastRequest: FieldValue.serverTimestamp(),
      });
      return;
    }

    const data = snap.data()!;
    const windowStartMs = data['windowStart'] && (data['windowStart'] as any).toMillis 
      ? (data['windowStart'] as any).toMillis() 
      : Date.now();

    if (now - windowStartMs > windowMs) {
      tx.set(ref, {
        ip,
        count: 1,
        windowStart: FieldValue.serverTimestamp(),
        lastRequest: FieldValue.serverTimestamp(),
      });
      return;
    }

    const currentCount = data['count'] as number;
    if (currentCount >= maxPerHour) {
      throw Errors.rateLimited('Too many requests from this IP. Please try again in an hour.');
    }

    tx.update(ref, {
      count: FieldValue.increment(1),
      lastRequest: FieldValue.serverTimestamp(),
    });
  });
}

// ─── OTP Generation & Storage ─────────────────────────────────────────────────

export interface GeneratedOtp {
  /** Plain-text OTP — send this to user. Never stored. */
  otp: string;
  /** Firestore doc ID of the OtpCodes doc */
  docId: string;
}

/**
 * Generates a 6-digit OTP, hashes it, and stores it in `otpCodes`.
 * Returns the plain OTP for emailing (it is NOT stored anywhere in plain text).
 */
export async function generateAndStoreOtp(email: string): Promise<GeneratedOtp> {
  const db = getAdminDb();
  const otp = generateOtp();
  const codeHash = hashOtp(otp);
  const expiryMinutes = env.OTP_EXPIRY_MINUTES ?? 10;
  const expiresAtMs = Date.now() + expiryMinutes * 60 * 1000;

  const docRef = await db.collection('otpCodes').add({
    email: email.toLowerCase(),
    codeHash,
    expiresAt: new Date(expiresAtMs), // Firestore auto-converts Date to Timestamp
    attempts: 0,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { otp, docId: docRef.id };
}

// ─── OTP Verification ─────────────────────────────────────────────────────────

export interface VerifyOtpResult {
  uid: string;
  email: string;
  role: UserRole;
  isNewUser: boolean;
  /** Firebase custom token — client exchanges via signInWithCustomToken() */
  customToken: string;
  invitedTeamId: string;
}

/**
 * Verifies the OTP for an email, creates or retrieves the Firebase Auth user,
 * upserts the Firestore users doc, and returns a Firebase custom token.
 *
 * The returned customToken must be used client-side with:
 *   `firebase.auth().signInWithCustomToken(customToken)`
 * to get a real ID token for subsequent API calls.
 */
export async function verifyOtpAndCreateSession(
  email: string,
  code: string,
): Promise<VerifyOtpResult> {
  const db = getAdminDb();
  const adminAuth = getAdminAuth();
  const normalizedEmail = email.toLowerCase();
  const maxAttempts = env.OTP_MAX_VERIFY_ATTEMPTS ?? 5;

  // ─── 1. Find the invite record ───────────────────────────────────────────
  // Re-check here to associate the user with the right invitedTeamId
  let invitedTeamId = '';
  let isAdmin = false;
  let existingRole: UserRole | null = null;

  const userSnap = await db
    .collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (!userSnap.empty) {
    const userData = userSnap.docs[0]!.data();
    if (userData['role'] === 'admin' || userData['role'] === 'super_admin') {
      isAdmin = true;
      existingRole = userData['role'] as UserRole;
      invitedTeamId = `admin-${userSnap.docs[0]!.id}`;
    }
  }

  let isMember = false;
  let memberTeamId = '';
  let memberInvitedTeamId = '';

  if (!isAdmin) {
    const inviteSnap = await db
      .collection('invitedTeams')
      .where('leaderEmail', '==', normalizedEmail)
      .limit(1)
      .get();

    if (inviteSnap.empty) {
      // Check if they are a member of a team
      const teamSnap = await db
        .collection('teams')
        .where('memberEmails', 'array-contains', normalizedEmail)
        .limit(1)
        .get();

      if (teamSnap.empty) {
        throw Errors.notInvited();
      }

      const teamDoc = teamSnap.docs[0]!;
      const teamData = teamDoc.data();

      if (teamData.status === 'Rejected') {
        throw Errors.forbidden('Your team application has been rejected.');
      }

      isMember = true;
      memberTeamId = teamDoc.id;
      memberInvitedTeamId = teamData.invitedTeamId || '';
      invitedTeamId = `member-${memberTeamId}-${normalizedEmail}`;
    } else {
      invitedTeamId = inviteSnap.docs[0]!.id;
    }
  }

  // ─── 2. Find a valid OTP (query by email only, filter in memory) ─────────
  // Filtering in memory avoids composite index requirements.
  // With max 40 invited teams issuing a handful of OTPs each, this is fine.
  const otpSnap = await db
    .collection('otpCodes')
    .where('email', '==', normalizedEmail)
    .get();

  const now = Date.now();

  // Find the most recently created OTP that hasn't been used and hasn't expired
  const candidates = otpSnap.docs
    .filter((doc) => {
      const d = doc.data();
      const expiresAt = d['expiresAt'] as Timestamp | Date;
      const expiresMs =
        expiresAt instanceof Date
          ? expiresAt.getTime()
          : expiresAt.toMillis();
      return !d['used'] && expiresMs > now;
    })
    .sort((a, b) => {
      const aCreated = a.data()['createdAt'] as Timestamp | null;
      const bCreated = b.data()['createdAt'] as Timestamp | null;
      const aMs = aCreated ? aCreated.toMillis() : 0;
      const bMs = bCreated ? bCreated.toMillis() : 0;
      return bMs - aMs; // Descending — newest first
    });

  if (candidates.length === 0) {
    throw Errors.otpInvalid();
  }

  const otpDoc = candidates[0]!;
  const otpData = otpDoc.data();
  const otpRef = otpDoc.ref;

  // ─── 3. Check attempt count ───────────────────────────────────────────────
  const attempts = (otpData['attempts'] as number) + 1;
  if (attempts > maxAttempts) {
    // Mark as used to prevent further attempts on this OTP
    await otpRef.update({ used: true, attempts });
    throw Errors.otpMaxAttempts();
  }

  // ─── 4. Compare hashes (constant-time-ish via SHA-256 string compare) ───
  const expectedHash = otpData['codeHash'] as string;
  const submittedHash = hashOtp(code.trim());

  if (submittedHash !== expectedHash) {
    await otpRef.update({ attempts });
    const remaining = maxAttempts - attempts;
    if (remaining <= 0) {
      await otpRef.update({ used: true });
      throw Errors.otpMaxAttempts();
    }
    throw Errors.validation(
      `Incorrect OTP code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
    );
  }

  // ─── 5. OTP is valid — mark as used ──────────────────────────────────────
  await otpRef.update({ used: true, attempts });

  // ─── 6. Create or retrieve Firebase Auth user ─────────────────────────────
  let uid: string;
  let isNewUser = false;

  try {
    const existingUser = await adminAuth.getUserByEmail(normalizedEmail);
    uid = existingUser.uid;
  } catch {
    // auth/user-not-found → create a new passwordless user
    const newUser = await adminAuth.createUser({
      email: normalizedEmail,
      emailVerified: true,
      // No password — user can only sign in via custom token (Phase 1 OTP flow)
    });
    uid = newUser.uid;
    isNewUser = true;
  }

  // ─── 7. Upsert the Firestore users doc ───────────────────────────────────
  let role: UserRole = 'participant_leader';
  if (isAdmin && existingRole) {
    role = existingRole;
  } else if (isMember) {
    role = 'participant_member';
  }
  
  if (role === 'super_admin' && normalizedEmail !== 'team@revengershack.tech') {
    role = 'admin';
  }

  const userRef = db.collection('users').doc(uid);
  const userDocSnap = await userRef.get();

  if (!userDocSnap.exists) {
    await userRef.set({
      uid,
      email: normalizedEmail,
      role,
      teamId: isMember ? memberTeamId : null,
      invitedTeamId: isAdmin ? null : (isMember ? memberInvitedTeamId : invitedTeamId),
      displayName: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
      isActive: true,
    });
  } else {
    const updateData: any = {
      lastLoginAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (isMember && !userDocSnap.data()?.teamId) {
      updateData.teamId = memberTeamId;
      updateData.role = 'participant_member';
    }
    await userRef.update(updateData);
  }

  // ─── 8. Update invitedTeams status → Verified ────────────────────────────
  if (!isAdmin && !isMember) {
    await db.collection('invitedTeams').doc(invitedTeamId).update({
      status: 'Verified',
      verifiedAt: FieldValue.serverTimestamp(),
    });

    if (isNewUser) {
        const baseUrl = process.env.NODE_ENV === 'production' ? 'https://revengershack.tech' : (env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173');
        const loginUrl = `${baseUrl}/dashboard`;
        await sendEmail({
            to: normalizedEmail,
            template: 'verified',
            variables: { loginUrl }
        }).catch(e => console.error("Failed to send verified email", e));
    }
  }

  // ─── 9. Issue Firebase custom token ──────────────────────────────────────
  // Client uses signInWithCustomToken(auth, customToken) to get a real ID token.
  // Custom claims are included so the client can read role without a Firestore call.
  const customToken = await adminAuth.createCustomToken(uid, { role });

  // ─── 10. Write audit log ─────────────────────────────────────────────────
  await writeAuditLog({
    action: isNewUser ? 'auth.user_created' : 'auth.otp_verified',
    actorUid: uid,
    actorRole: role,
    targetId: invitedTeamId,
    targetType: 'invitedTeams',
    metadata: { email: normalizedEmail, isNewUser },
    ip: null, // Caller should pass the real IP — omitted here for now
  });

  return { uid, email: normalizedEmail, role, isNewUser, customToken, invitedTeamId };
}
