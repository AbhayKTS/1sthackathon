/**
 * Shared TypeScript types for authentication and authorization.
 * Used across both lib/ and server/services/.
 *
 * @module types/auth
 */

/**
 * All valid user roles in the system.
 * Kept as a union string literal — generic enough to add 'judge', 'mentor'
 * without RBAC refactoring (see D-005 in DECISIONS.md).
 */
export type UserRole =
  | 'participant_leader'
  | 'participant_member'
  | 'admin'
  | 'super_admin';

/** Roles that have admin-level access */
export const ADMIN_ROLES: UserRole[] = ['admin', 'super_admin'];

/** Roles that are hackathon participants */
export const PARTICIPANT_ROLES: UserRole[] = ['participant_leader', 'participant_member'];

/**
 * Firestore Users document shape.
 * Must stay in sync with SCHEMA.md.
 */
export interface UserDoc {
  uid: string;
  email: string;
  role: UserRole;
  teamId: string | null;
  invitedTeamId: string | null;
  displayName: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  lastLoginAt: FirebaseFirestore.Timestamp | null;
  isActive: boolean;
}
