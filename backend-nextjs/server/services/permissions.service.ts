/**
 * Permissions Service — RBAC management.
 *
 * Extends the basic role field with granular permission flags.
 * Only super_admin can manage permissions.
 *
 * @module server/services/permissions.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import type { UserRole, PermissionsDoc } from '@/types/index';

// ─── Default permissions by role ──────────────────────────────────────────────

const DEFAULT_PERMISSIONS: Record<UserRole, Omit<PermissionsDoc, 'userId' | 'grantedBy' | 'grantedAt' | 'updatedAt'>> = {
  super_admin: {
    role: 'super_admin',
    canEditScores: true,
    canPublishScores: true,
    canManageRounds: true,
    canManageTeams: true,
    canSendEmails: true,
    canViewLogs: true,
  },
  admin: {
    role: 'admin',
    canEditScores: false,
    canPublishScores: false,
    canManageRounds: true,
    canManageTeams: true,
    canSendEmails: true,
    canViewLogs: true,
  },
  participant_leader: {
    role: 'participant_leader',
    canEditScores: false,
    canPublishScores: false,
    canManageRounds: false,
    canManageTeams: false,
    canSendEmails: false,
    canViewLogs: false,
  },
  participant_member: {
    role: 'participant_member',
    canEditScores: false,
    canPublishScores: false,
    canManageRounds: false,
    canManageTeams: false,
    canSendEmails: false,
    canViewLogs: false,
  },
};

// ─── Operations ───────────────────────────────────────────────────────────────

export interface UpdatePermissionsInput {
  role?: UserRole;
  canEditScores?: boolean;
  canPublishScores?: boolean;
  canManageRounds?: boolean;
  canManageTeams?: boolean;
  canSendEmails?: boolean;
  canViewLogs?: boolean;
}

/**
 * Gets or initializes permissions for a user.
 * If no permissions doc exists, creates one with role defaults.
 */
export async function getOrInitPermissions(userId: string): Promise<PermissionsDoc> {
  const db = getAdminDb();
  const ref = db.collection('permissions').doc(userId);
  const snap = await ref.get();

  if (snap.exists) {
    return snap.data() as PermissionsDoc;
  }

  // Get role from users doc to initialize permissions
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) throw Errors.notFound(`User "${userId}"`);

  const role = (userSnap.data()!['role'] as UserRole) ?? 'participant_member';
  const defaults = DEFAULT_PERMISSIONS[role];

  const permissions: Omit<PermissionsDoc, 'grantedAt' | 'updatedAt'> & {
    grantedAt: unknown;
    updatedAt: unknown;
  } = {
    userId,
    ...defaults,
    grantedBy: 'system',
    grantedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await ref.set(permissions);
  return permissions as unknown as PermissionsDoc;
}

/**
 * Updates permissions for a user. Only super_admin can call this.
 * Also syncs the role field on the Users doc if role is being changed.
 */
export async function updatePermissions(
  superAdminUid: string,
  targetUserId: string,
  input: UpdatePermissionsInput,
): Promise<void> {
  const db = getAdminDb();

  const permRef = db.collection('permissions').doc(targetUserId);
  const existing = await getOrInitPermissions(targetUserId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { updatedAt: FieldValue.serverTimestamp() };

  if (input.role !== undefined) {
    if (input.role === 'super_admin') {
      const targetUserSnap = await db.collection('users').doc(targetUserId).get();
      if (!targetUserSnap.exists) {
        throw Errors.notFound('Target user document not found.');
      }
      const targetEmail = (targetUserSnap.data()?.email as string || '').toLowerCase().trim();
      if (targetEmail !== 'team@revengershack.tech') {
        throw Errors.validation('Only team@revengershack.tech is allowed to hold the super_admin role.');
      }
    }
    update.role = input.role;
    // Apply role defaults first, then override with explicit flags
    const roleDefaults = DEFAULT_PERMISSIONS[input.role];
    Object.assign(update, roleDefaults);
  }

  if (input.canEditScores !== undefined) update.canEditScores = input.canEditScores;
  if (input.canPublishScores !== undefined) update.canPublishScores = input.canPublishScores;
  if (input.canManageRounds !== undefined) update.canManageRounds = input.canManageRounds;
  if (input.canManageTeams !== undefined) update.canManageTeams = input.canManageTeams;
  if (input.canSendEmails !== undefined) update.canSendEmails = input.canSendEmails;
  if (input.canViewLogs !== undefined) update.canViewLogs = input.canViewLogs;

  await permRef.update(update);

  // If role changed, sync to users doc and users collection
  if (input.role && input.role !== existing.role) {
    await db.collection('users').doc(targetUserId).update({
      role: input.role,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await writeAuditLog({
    action: 'admin.permission_changed',
    actorUid: superAdminUid,
    actorRole: 'super_admin',
    targetId: targetUserId,
    targetType: 'permissions',
    metadata: {
      updatedFields: Object.keys(input),
      previousRole: existing.role,
      newRole: input.role ?? existing.role,
    },
    ip: null,
  });
}

/**
 * Lists all users with their permissions. Paginated.
 */
export async function listAllPermissions(opts: {
  role?: UserRole;
  limit?: number;
  startAfter?: string;
}): Promise<{ permissions: Array<Record<string, unknown>>; users: Array<Record<string, unknown>>; hasMore: boolean }> {
  const db = getAdminDb();
  const limit = opts.limit ?? 50;

  let query = db.collection('users').orderBy('email').limit(limit + 1);

  if (opts.role) {
    query = query.where('role', '==', opts.role) as typeof query;
  }

  if (opts.startAfter) {
    const cursorSnap = await db.collection('users').doc(opts.startAfter).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap) as typeof query;
  }

  const usersSnap = await query.get();
  const hasMore = usersSnap.docs.length > limit;
  const users = usersSnap.docs.slice(0, limit);

  // Fetch permissions in parallel
  const permissionDocs = await Promise.all(
    users.map((u) => db.collection('permissions').doc(u.id).get())
  );

  const registeredUsers = users.map((userDoc, idx) => {
    const permSnap = permissionDocs[idx];
    const userData = userDoc.data()!;
    return {
      userId: userDoc.id,
      uid: userDoc.id,
      email: userData['email'],
      role: userData['role'],
      displayName: userData['displayName'] || '',
      teamId: userData['teamId'] || null,
      isActive: userData['isActive'] !== false,
      ...(permSnap?.exists ? permSnap.data() : {}),
    };
  });

  // Query all approved teams to find expected members who haven't logged in/onboarded yet
  const pendingMembers: Array<Record<string, unknown>> = [];
  try {
    const teamsSnap = await db.collection('teams').where('status', '==', 'Approved').get();
    teamsSnap.docs.forEach((teamDoc) => {
      const teamData = teamDoc.data();
      const members = (teamData['members'] || []) as Array<{
        uid: string | null;
        name: string;
        email: string;
        role: string;
      }>;

      members.forEach((m) => {
        if (!m.uid) {
          pendingMembers.push({
            userId: `PENDING-${m.email}`,
            uid: `PENDING-${m.email}`,
            email: m.email.toLowerCase().trim(),
            role: m.role || 'participant_member',
            displayName: `${m.name} (Pending Onboarding)`,
            teamId: teamDoc.id,
            status: 'Pending Onboarding',
          });
        }
      });
    });
  } catch (err) {
    console.error('[permissions.service] Failed to fetch pending members:', err);
  }

  const combinedResult = [...registeredUsers, ...pendingMembers];

  return { permissions: combinedResult, users: combinedResult, hasMore };
}

/**
 * Creates a new admin/staff user with specified role.
 * Sends an admin invite email via the mail queue.
 */
export async function createAdminUser(
  superAdminUid: string,
  input: { email: string; role: UserRole; displayName: string },
): Promise<void> {
  const db = getAdminDb();
  const { getAdminAuth } = await import('@/lib/firebase-admin');

  const normalizedEmail = input.email.toLowerCase().trim();

  // Only 'admin' role may be created via this function.
  // super_admin is exclusively team@revengershack.tech and managed by ensure-super-admin script.
  // participant roles are created exclusively via the OTP/onboarding flow.
  if (input.role !== 'admin') {
    throw Errors.validation(
      'createAdminUser only accepts role \'admin\'. ' +
      'super_admin is managed by the ensure-super-admin script. ' +
      'Participant accounts are created via OTP/onboarding.',
    );
  }

  // Create Firebase Auth user if not exists
  let uid: string;
  try {
    const existing = await getAdminAuth().getUserByEmail(normalizedEmail);
    uid = existing.uid;
  } catch {
    const newUser = await getAdminAuth().createUser({
      email: normalizedEmail,
      emailVerified: true,
    });
    uid = newUser.uid;
  }

  // Create/update users doc
  await db.collection('users').doc(uid).set({
    uid,
    email: normalizedEmail,
    role: input.role,
    displayName: input.displayName.trim(),
    teamId: null,
    invitedTeamId: null,
    phone: null,
    college: null,
    github: null,
    onboardingStatus: 'complete',
    isActive: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: null,
  }, { merge: true });

  // Initialize permissions
  await db.collection('permissions').doc(uid).set({
    userId: uid,
    ...DEFAULT_PERMISSIONS[input.role],
    grantedBy: superAdminUid,
    grantedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Queue invite email
  const { createMailJob } = await import('./mail-queue.service');
  const { getPortalBaseUrl } = await import('@/lib/env');
  const loginUrl = `${getPortalBaseUrl()}/login`;

  await createMailJob({
    to: normalizedEmail,
    template: 'admin_invite',
    variables: { loginUrl, roleName: input.role.replace('_', ' ') },
    priority: 'high',
    createdBy: superAdminUid,
  });

  await writeAuditLog({
    action: 'admin.created',
    actorUid: superAdminUid,
    actorRole: 'super_admin',
    targetId: uid,
    targetType: 'users',
    metadata: { email: normalizedEmail, role: input.role },
    ip: null,
  });
}
