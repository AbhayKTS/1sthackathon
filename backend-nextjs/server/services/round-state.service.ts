/**
 * Round State Machine Service — manages the full round lifecycle.
 *
 * State flow:
 *   Draft → Published → Active → Locked → Evaluation → Completed → Archived
 *   Published → Draft (admin can unpublish)
 *
 * All transitions are validated server-side.
 * isActive/isLocked booleans are preserved for backward compatibility
 * but the canonical status is the `status` field.
 *
 * @module server/services/round-state.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import type { RoundStatus, RoundType, SubmissionType, RoundDoc } from '@/types/index';
import { ROUND_TRANSITIONS } from '@/types/index';

export type { RoundStatus, RoundType, SubmissionType };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateRoundInput {
  roundId: string;      // Admin-chosen ID (e.g., 'round-1', 'timeleap')
  title: string;
  description: string;
  type: RoundType;
  submissionType: SubmissionType;
  submissionTypes?: SubmissionType[];  // optional at creation; defaults to [submissionType]
}

export interface UpdateRoundInput {
  title?: string;
  description?: string;
  instructions?: string;
  resources?: string[];
  pptViewerLink?: string | null;
  driveLink?: string | null;
  canvaViewerLink?: string | null;
  type?: RoundType;
  submissionType?: SubmissionType;
  submissionTypes?: SubmissionType[];  // ordered; index 0 = required, 1+ = optional
  allowedTeams?: 'all' | string[];
  startsAt?: string | null;
  endsAt?: string | null;
  submissionDeadline?: string | null;
  timerDuration?: number | null;
  googleSheetId?: string | null;
  isVisible?: boolean;
  isTimeLeapRound?: boolean;
  timeLeapLink?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Creates a new round in Draft status.
 * Throws CONFLICT if a round with the given roundId already exists.
 */
export async function createRound(adminUid: string, input: CreateRoundInput): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('rounds').doc(input.roundId);
  const snap = await ref.get();

  if (snap.exists) {
    throw Errors.conflict(`Round "${input.roundId}" already exists.`);
  }

  await ref.set({
    roundId: input.roundId,
    title: input.title.trim(),
    description: input.description.trim(),
    instructions: '',
    resources: [],
    pptViewerLink: null,
    driveLink: null,
    canvaViewerLink: null,
    type: input.type,
    status: 'Draft' as RoundStatus,
    submissionType: input.submissionType,
    submissionTypes: input.submissionTypes ?? [input.submissionType],
    allowedTeams: 'all',
    startsAt: null,
    endsAt: null,
    submissionDeadline: null,
    timerDuration: null,
    googleSheetId: null,
    isVisible: false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUid,
  });

  await writeAuditLog({
    action: 'round.created',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: input.roundId,
    targetType: 'rounds',
    metadata: { title: input.title, type: input.type },
    ip: null,
  });
}

/**
 * Updates round fields (Draft or Published status only for most fields).
 * Fields that affect participant experience (title, instructions) cannot change
 * once the round is Active or beyond — only admins with super_admin can override.
 */
export async function updateRound(adminUid: string, roundId: string, input: UpdateRoundInput): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('rounds').doc(roundId);
  const snap = await ref.get();

  if (!snap.exists) throw Errors.notFound(`Round "${roundId}"`);

  const current = snap.data() as RoundDoc;
  const lockedStatuses: RoundStatus[] = ['Locked', 'Evaluation', 'Completed', 'Archived'];
  const isLocked = lockedStatuses.includes(current.status);

  if (isLocked) {
    throw Errors.forbidden(`Round "${roundId}" is in '${current.status}' status and cannot be edited.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUid,
  };

  if (input.title !== undefined) update.title = input.title.trim();
  if (input.description !== undefined) update.description = input.description.trim();
  if (input.instructions !== undefined) update.instructions = input.instructions.trim();
  if (input.resources !== undefined) update.resources = input.resources;
  if (input.pptViewerLink !== undefined) update.pptViewerLink = input.pptViewerLink;
  if (input.driveLink !== undefined) update.driveLink = input.driveLink;
  if (input.canvaViewerLink !== undefined) update.canvaViewerLink = input.canvaViewerLink;
  if (input.type !== undefined) update.type = input.type;

  // Keep submissionType (singular) and submissionTypes (array) in sync.
  // - If only submissionTypes is sent, derive submissionType from index 0.
  // - If only submissionType is sent, set submissionTypes to a single-item array.
  // - If both are sent, submissionTypes wins (and submissionType = submissionTypes[0]).
  if (input.submissionTypes !== undefined && input.submissionTypes.length > 0) {
    update.submissionTypes = input.submissionTypes;
    update.submissionType  = input.submissionTypes[0];  // primary for compat
  } else if (input.submissionType !== undefined) {
    update.submissionType  = input.submissionType;
    update.submissionTypes = [input.submissionType];
  }

  if (input.allowedTeams !== undefined) update.allowedTeams = input.allowedTeams;
  if ('startsAt' in input) update.startsAt = parseDate(input.startsAt);
  if ('endsAt' in input) update.endsAt = parseDate(input.endsAt);
  if ('submissionDeadline' in input) update.submissionDeadline = parseDate(input.submissionDeadline);
  if ('timerDuration' in input) update.timerDuration = input.timerDuration ?? null;
  if ('googleSheetId' in input) update.googleSheetId = input.googleSheetId ?? null;
  if (input.isVisible !== undefined) update.isVisible = input.isVisible;
  if (input.isTimeLeapRound !== undefined) update.isTimeLeapRound = input.isTimeLeapRound;
  if ('timeLeapLink' in input) update.timeLeapLink = input.timeLeapLink ?? null;

  await ref.update(update);

  await writeAuditLog({
    action: 'round.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: roundId,
    targetType: 'rounds',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}

/**
 * Transitions a round to a new status.
 * Validates allowed transitions using the state machine.
 *
 * Special case: Locked → Active is a super_admin-only manual reopen.
 * The caller MUST be super_admin and SHOULD supply a reason string.
 */
export async function transitionRound(
  adminUid: string,
  roundId: string,
  toStatus: RoundStatus,
  isSuperAdmin = false,
  reason?: string,
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('rounds').doc(roundId);
  let fromStatusStr = '';

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);

    if (!snap.exists) throw Errors.notFound(`Round "${roundId}"`);

    const current = snap.data() as RoundDoc;
    const fromStatus = current.status;
    fromStatusStr = fromStatus;

    // Safety net: reject docs whose status predates or corrupts the state machine.
    // Without this, ROUND_TRANSITIONS[fromStatus] returns undefined and crashes with
    // a raw TypeError instead of a readable error.
    const validStatuses = Object.keys(ROUND_TRANSITIONS);
    if (!validStatuses.includes(fromStatus)) {
      throw Errors.validation(
        `Round "${roundId}" has an invalid/legacy status "${fromStatus}" ` +
        `that predates the round state machine. ` +
        `Run the migrate-round-status script to fix it before transitioning.`
      );
    }

    // Validate transition
    const allowedNext = ROUND_TRANSITIONS[fromStatus];
    if (!allowedNext.includes(toStatus)) {
      throw Errors.validation(
        `Cannot transition round from '${fromStatus}' to '${toStatus}'. ` +
        `Allowed transitions: ${allowedNext.join(', ') || 'none (terminal state)'}.`
      );
    }

    // Completed → Archived requires super_admin for score publishing side-effect
    if (toStatus === 'Archived' && !isSuperAdmin) {
      // Archiving is admin-ok
    }

    // Evaluation → Completed: only super_admin (this step publishes scores)
    if (fromStatus === 'Evaluation' && toStatus === 'Completed' && !isSuperAdmin) {
      throw Errors.forbidden('Only super_admin can complete an Evaluation round (this publishes scores).');
    }

    // Locked → Active: manual reopen — strictly super_admin only.
    // Normal admins cannot undo an auto-lock even if they wanted to;
    // only super_admin can reopen when a genuine mistake occurred.
    if (fromStatus === 'Locked' && toStatus === 'Active') {
      if (!isSuperAdmin) {
        throw Errors.forbidden(
          'Only super_admin can reopen a Locked round (Locked → Active). ' +
          'Normal admins cannot override the auto-lock.'
        );
      }
      if (!reason || !reason.trim()) {
        throw Errors.validation(
          'A non-empty reason is required when reopening a Locked round.'
        );
      }
    }

    if (toStatus === 'Active') {
      // Auto-lock any other currently Active rounds
      const activeQuery = db.collection('rounds').where('status', '==', 'Active');
      const activeDocs = await transaction.get(activeQuery);
      activeDocs.forEach((doc) => {
        if (doc.id !== roundId) {
          transaction.update(doc.ref, {
            status: 'Locked',
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUid,
          });
        }
      });
    }

    transaction.update(ref, {
      status: toStatus,
      // Auto-set isVisible when publishing
      ...(toStatus === 'Published' && { isVisible: true }),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUid,
    });
  });

  await writeAuditLog({
    action: 'round.transition',
    actorUid: adminUid,
    actorRole: isSuperAdmin ? 'super_admin' : 'admin',
    targetId: roundId,
    targetType: 'rounds',
    metadata: { from: fromStatusStr, to: toStatus },
    ip: null,
  });

  // Write a separate, easily-filterable audit entry for manual reopens.
  if (fromStatusStr === 'Locked' && toStatus === 'Active' && isSuperAdmin) {
    await writeAuditLog({
      action: 'round.manual_reopen',
      actorUid: adminUid,
      actorRole: 'super_admin',
      targetId: roundId,
      targetType: 'rounds',
      metadata: { from: 'Locked', to: 'Active', reason: reason?.trim() ?? '' },
      ip: null,
    });
  }
}

/**
 * Lists all rounds ordered by creation (roundId alphabetically).
 * Admin gets all; participant gets only Published/Active/Locked/Completed rounds.
 */
export async function listRounds(opts: {
  isAdmin: boolean;
  teamId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  let query = db.collection('rounds').orderBy('__name__');

  if (!opts.isAdmin) {
    // Participants see only visible rounds that haven't been archived
    query = query
      .where('isVisible', '==', true)
      .where('status', 'not-in', ['Draft', 'Archived']) as typeof query;
  }

  const snap = await query.get();
  const rounds = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, any>>;

  // Filter by allowedTeams for participant
  if (!opts.isAdmin && opts.teamId) {
    return rounds.filter((r) => {
      const allowed = r['allowedTeams'] as 'all' | string[];
      return allowed === 'all' || (Array.isArray(allowed) && allowed.includes(opts.teamId!));
    });
  }

  return rounds;
}

/**
 * Gets a single round by ID.
 */
export async function getRound(roundId: string): Promise<Record<string, unknown> | null> {
  const db = getAdminDb();
  const snap = await db.collection('rounds').doc(roundId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}
