/**
 * Invitation Service — Admin-controlled team import and invitation.
 *
 * Phase 1: Admin imports teams (CSV or Excel) → creates invitedTeams in Draft status
 * Phase 2: Admin edits draft (domain, PS, members, corrections)
 * Phase 3: Admin clicks "Send Invitation" → queues leader invitation email
 *
 * Excel support: requires 'xlsx' npm package (install: npm i xlsx)
 *
 * @module server/services/invitation.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import { createMailJob } from './mail-queue.service';
import { getPortalBaseUrl } from '@/lib/env';
import type { UserRole, InvitedTeamStatus, InvitedTeamDoc } from '@/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CsvRow {
  teamName: string;
  leaderName: string;
  leaderEmail: string;
  leaderPhone: string;
  college: string;
  domain?: string;
  problemStatement?: string;
  member1Name?: string;
  member1Email?: string;
  member1Role?: string;
  member1College?: string;
  member2Name?: string;
  member2Email?: string;
  member2Role?: string;
  member2College?: string;
  member3Name?: string;
  member3Email?: string;
  member3Role?: string;
  member3College?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; email: string; reason: string }>;
}

export interface EditDraftInput {
  teamName?: string;
  leaderName?: string;
  leaderPhone?: string;
  college?: string;
  domain?: string;
  problemStatement?: string;
  isCustomPS?: boolean;
  members?: Array<{
    name: string;
    email: string;
    role: string;
    college: string;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMembersFromRow(row: CsvRow): Array<{
  name: string; email: string; role: string; college: string;
}> {
  const members: Array<{ name: string; email: string; role: string; college: string }> = [];

  for (let i = 1; i <= 3; i++) {
    const name = row[`member${i}Name` as keyof CsvRow] as string;
    const email = row[`member${i}Email` as keyof CsvRow] as string;
    const role = row[`member${i}Role` as keyof CsvRow] as string;
    const college = row[`member${i}College` as keyof CsvRow] as string;

    if (name?.trim() && email?.trim()) {
      members.push({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role: role?.trim() || '',
        college: college?.trim() || row.college?.trim() || '',
      });
    }
  }

  return members;
}

// ─── Import CSV/Excel ─────────────────────────────────────────────────────────

/**
 * Imports a batch of teams from parsed CSV/Excel data.
 * Creates invitedTeams documents in Draft status.
 * Skips duplicates by leaderEmail.
 * Uses chunked batched writes (50/batch).
 */
import { z } from 'zod';

const CsvRowSchema = z.object({
  teamName: z.string().min(1, 'Team name is required.').max(100, 'Team name too long.'),
  leaderName: z.string().min(1, 'Leader name is required.').max(100, 'Leader name too long.'),
  leaderEmail: z.string().email('Invalid email format.').toLowerCase().trim(),
  leaderPhone: z.string().min(10, 'Phone must be at least 10 digits.').max(15, 'Phone too long.').trim(),
  college: z.string().min(1, 'College is required.').max(200, 'College name too long.'),
  domain: z.string().max(100).optional(),
  problemStatement: z.string().max(2000).optional(),
});

function hasFormulaInjection(val: string | undefined | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return trimmed.startsWith('=') || trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('@');
}

/**
 * Imports a batch of teams from parsed CSV/Excel data.
 * Creates invitedTeams documents in Draft status.
 * Skips duplicates by leaderEmail.
 * Uses chunked batched writes (50/batch).
 */
export async function importInvitations(
  records: CsvRow[],
  actorUid: string,
  actorRole: UserRole,
  batchId: string,
): Promise<ImportResult> {
  const db = getAdminDb();

  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Fetch all existing emails and phones from invitedTeams (for deduplication)
  const existingInvitedDocs = await db.collection('invitedTeams').select('leaderEmail', 'leaderPhone').get();
  const existingEmails = new Set(
    existingInvitedDocs.docs.map((doc) => (doc.data()['leaderEmail'] as string).toLowerCase().trim())
  );
  const existingPhones = new Set(
    existingInvitedDocs.docs.map((doc) => (doc.data()['leaderPhone'] as string).trim())
  );

  // Fetch all existing emails and phones from verified teams
  const existingTeamDocs = await db.collection('teams').select('leaderEmail', 'leaderPhone').get();
  existingTeamDocs.docs.forEach((doc) => {
    const data = doc.data();
    if (data['leaderEmail']) existingEmails.add(data['leaderEmail'].toLowerCase().trim());
    if (data['leaderPhone']) existingPhones.add(data['leaderPhone'].trim());
  });

  const validRecords: CsvRow[] = [];

  records.forEach((record, idx) => {
    // 1. Zod input validation
    const parsed = CsvRowSchema.safeParse(record);
    if (!parsed.success) {
      result.failed++;
      result.errors.push({
        row: idx + 2,
        email: record.leaderEmail || '',
        reason: parsed.error.issues[0]?.message || 'Validation error'
      });
      return;
    }

    const data = parsed.data;

    // 2. CSV Formula Injection check
    const hasInjection = Object.values(record).some(val => 
      typeof val === 'string' && hasFormulaInjection(val)
    );
    if (hasInjection) {
      result.failed++;
      result.errors.push({
        row: idx + 2,
        email: data.leaderEmail,
        reason: 'Formula Injection detected (value starts with =, +, -, @)'
      });
      return;
    }

    // 3. Member Validation
    const members = extractMembersFromRow(record);
    if (members.length < 1 || members.length > 3) {
      result.failed++;
      result.errors.push({
        row: idx + 2,
        email: data.leaderEmail,
        reason: `Team must have between 2 and 4 members total (leader + 1-3 members). Got members: ${members.length + 1}`
      });
      return;
    }

    for (const m of members) {
      if (hasFormulaInjection(m.name) || hasFormulaInjection(m.email) || hasFormulaInjection(m.college)) {
        result.failed++;
        result.errors.push({
          row: idx + 2,
          email: data.leaderEmail,
          reason: 'Formula Injection detected in member details'
        });
        return;
      }
      if (!m.email.includes('@')) {
        result.failed++;
        result.errors.push({
          row: idx + 2,
          email: data.leaderEmail,
          reason: `Invalid email format for member: ${m.email}`
        });
        return;
      }
    }

    // 4. Duplicate checks
    if (existingEmails.has(data.leaderEmail)) {
      result.skipped++;
      return;
    }
    if (existingPhones.has(data.leaderPhone)) {
      result.failed++;
      result.errors.push({
        row: idx + 2,
        email: data.leaderEmail,
        reason: `Duplicate phone number: ${data.leaderPhone}`
      });
      return;
    }

    validRecords.push(record);
    existingEmails.add(data.leaderEmail); // Prevent intra-CSV duplicates
    existingPhones.add(data.leaderPhone);
  });

  if (validRecords.length === 0) return result;

  const CHUNK_SIZE = 50;
  for (let i = 0; i < validRecords.length; i += CHUNK_SIZE) {
    const chunk = validRecords.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();

    for (const record of chunk) {
      const docRef = db.collection('invitedTeams').doc();
      const members = extractMembersFromRow(record);

      batch.set(docRef, {
        teamName: record.teamName.trim(),
        leaderName: record.leaderName?.trim() || '',
        leaderEmail: record.leaderEmail.toLowerCase().trim(),
        leaderPhone: record.leaderPhone?.trim() || '',
        college: record.college?.trim() || '',
        domain: record.domain?.trim() || '',
        problemStatement: record.problemStatement?.trim() || '',
        isCustomPS: false,
        members,
        status: 'Draft' as InvitedTeamStatus,
        importBatchId: batchId,
        importedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        invitationSentAt: null,
        leaderRegisteredAt: null,
        allMembersRegisteredAt: null,
        lockedAt: null,
      });
    }

    try {
      await batch.commit();
      result.imported += chunk.length;
    } catch (err) {
      console.error('[invitation.service] Batch commit failed:', err);
      result.failed += chunk.length;
    }
  }

  await writeAuditLog({
    action: 'team.import_batch_created',
    actorUid,
    actorRole,
    targetId: batchId,
    targetType: 'invitedTeams',
    metadata: {
      batchId,
      totalProvided: records.length,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
    },
    ip: null,
  });

  return result;
}

// ─── Edit Draft ───────────────────────────────────────────────────────────────

/**
 * Admin edits an invitedTeam draft before sending the invitation.
 * Allowed only while status is 'Draft' or 'Invited'.
 */
export async function editDraftTeam(
  adminUid: string,
  invitedTeamId: string,
  input: EditDraftInput,
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('invitedTeams').doc(invitedTeamId);
  const snap = await ref.get();

  if (!snap.exists) throw Errors.notFound(`Invited team "${invitedTeamId}"`);

  const current = snap.data() as InvitedTeamDoc;
  const editableStatuses: InvitedTeamStatus[] = ['Draft', 'Invited'];

  if (!editableStatuses.includes(current.status)) {
    throw Errors.forbidden(
      `Cannot edit an invitedTeam with status "${current.status}". ` +
      `Only Draft and Invited teams can be edited.`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { updatedAt: FieldValue.serverTimestamp() };

  if (input.teamName) update.teamName = input.teamName.trim();
  if (input.leaderName) update.leaderName = input.leaderName.trim();
  if (input.leaderPhone) update.leaderPhone = input.leaderPhone.trim();
  if (input.college) update.college = input.college.trim();
  if (input.domain !== undefined) update.domain = input.domain.trim();
  if (input.problemStatement !== undefined) update.problemStatement = input.problemStatement.trim();
  if (input.isCustomPS !== undefined) update.isCustomPS = input.isCustomPS;
  if (input.members !== undefined) {
    if (input.members.length < 1 || input.members.length > 3) {
      throw Errors.validation('Team must have between 2 and 4 members total (leader + 1-3 members).');
    }
    update.members = input.members.map((m) => ({
      name: m.name.trim(),
      email: m.email.toLowerCase().trim(),
      role: m.role.trim(),
      college: m.college.trim(),
    }));
  }

  await ref.update(update);

  await writeAuditLog({
    action: 'team.draft_edited',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: invitedTeamId,
    targetType: 'invitedTeams',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}

// ─── Send Invitation ──────────────────────────────────────────────────────────

/**
 * Sends the leader invitation email for a Draft team.
 * Creates a mailQueue job (high priority).
 * Updates invitedTeam status to 'Invited'.
 */
export async function sendLeaderInvitation(
  adminUid: string,
  invitedTeamId: string,
): Promise<string> {
  const db = getAdminDb();
  const ref = db.collection('invitedTeams').doc(invitedTeamId);
  const snap = await ref.get();

  if (!snap.exists) throw Errors.notFound(`Invited team "${invitedTeamId}"`);

  const data = snap.data() as InvitedTeamDoc;

  if (data.status !== 'Draft') {
    throw Errors.validation(
      `Invitation already sent for this team (status: "${data.status}").`
    );
  }

  if (!data.leaderEmail) {
    throw Errors.validation('Team has no leader email. Please edit the draft first.');
  }

  const loginUrl = `${getPortalBaseUrl()}/login`;

  const jobId = await createMailJob({
    to: data.leaderEmail,
    template: 'leader_invitation',
    variables: {
      teamName: data.teamName,
      leaderName: data.leaderName,
      loginUrl,
    },
    priority: 'high',
    createdBy: adminUid,
  });

  // Update invitedTeam status to Invited
  await ref.update({
    status: 'Invited' as InvitedTeamStatus,
    invitationSentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'team.invitation_sent',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: invitedTeamId,
    targetType: 'invitedTeams',
    metadata: { leaderEmail: data.leaderEmail, mailJobId: jobId },
    ip: null,
  });

  return jobId;
}

/**
 * Bulk send invitations to multiple Draft teams.
 * Returns a summary of queued/skipped.
 */
export async function bulkSendInvitations(
  adminUid: string,
  invitedTeamIds: string[],
): Promise<{ queued: number; skipped: number; errors: string[] }> {
  const results = { queued: 0, skipped: 0, errors: [] as string[] };

  for (const id of invitedTeamIds) {
    try {
      await sendLeaderInvitation(adminUid, id);
      results.queued++;
    } catch (err) {
      results.skipped++;
      results.errors.push(`${id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return results;
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Lists invited teams with optional status filter. Paginated.
 */
export async function listInvitedTeams(opts: {
  status?: InvitedTeamStatus | InvitedTeamStatus[];
  batchId?: string;
  limit?: number;
  startAfter?: string;
}): Promise<{ teams: Array<Record<string, unknown>>; hasMore: boolean }> {
  const db = getAdminDb();
  const limit = opts.limit ?? 50;

  let query = db.collection('invitedTeams').orderBy('importedAt', 'desc').limit(limit + 1);

  if (opts.status) {
    const statusArray = Array.isArray(opts.status) ? opts.status : [opts.status];
    query = query.where('status', 'in', statusArray) as typeof query;
  }

  if (opts.batchId) {
    query = query.where('importBatchId', '==', opts.batchId) as typeof query;
  }

  if (opts.startAfter) {
    const cursorSnap = await db.collection('invitedTeams').doc(opts.startAfter).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap) as typeof query;
  }

  const snap = await query.get();
  const hasMore = snap.docs.length > limit;

  return {
    teams: snap.docs.slice(0, limit).map((d) => ({ id: d.id, ...d.data() })),
    hasMore,
  };
}
