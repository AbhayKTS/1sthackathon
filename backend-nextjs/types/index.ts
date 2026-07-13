/**
 * RevengersHack 2026 — Platform Type Definitions
 *
 * Single source of truth for all platform-wide types.
 * Shared between API routes and service layer.
 *
 * @module types/index
 */

import type { Timestamp } from 'firebase-admin/firestore';

// ─── Roles ────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'mentor'
  | 'judge'
  | 'volunteer'
  | 'participant_leader'
  | 'participant_member';

export const ADMIN_ROLES: UserRole[] = ['super_admin', 'admin'];
export const PARTICIPANT_ROLES: UserRole[] = ['participant_leader', 'participant_member'];
export const ALL_ROLES: UserRole[] = ['super_admin', 'admin', 'mentor', 'judge', 'volunteer', 'participant_leader', 'participant_member'];

// ─── Users ────────────────────────────────────────────────────────────────────

export interface UserDoc {
  uid: string;
  email: string;
  role: UserRole;
  teamId: string | null;
  invitedTeamId: string | null;
  displayName: string | null;
  phone: string | null;
  college: string | null;
  github: string | null;
  onboardingStatus: 'pending' | 'complete';
  canEditScores: boolean;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt: Timestamp | null;
}

// ─── Invited Teams (Admin-controlled draft) ───────────────────────────────────

export type InvitedTeamStatus =
  | 'Draft'
  | 'Invited'
  | 'EmailSent'
  | 'LeaderRegistered'
  | 'MembersInvited'
  | 'Verified'
  | 'Locked';

export interface InvitedTeamMember {
  name: string;
  email: string;
  role: string;
  college: string;
}

export interface InvitedTeamDoc {
  teamName: string;
  leaderName: string;
  leaderEmail: string;
  leaderPhone: string;
  college: string;
  domain: string;
  problemStatement: string;
  isCustomPS: boolean;
  members: InvitedTeamMember[];
  status: InvitedTeamStatus;
  importBatchId: string;
  importedAt: Timestamp;
  updatedAt: Timestamp;
  invitationSentAt: Timestamp | null;
  leaderRegisteredAt: Timestamp | null;
  allMembersRegisteredAt: Timestamp | null;
  lockedAt: Timestamp | null;
}

// ─── Teams ────────────────────────────────────────────────────────────────────

export type TeamStatus = 'Draft' | 'Verified';

export interface TeamMemberDoc {
  uid: string | null;
  name: string;
  email: string;
  phone: string;
  role: string;
  college: string;
  github: string | null;
  onboardingComplete: boolean;
  joinedAt: Timestamp | null;
}

export interface TeamDoc {
  teamName: string;
  invitedTeamId: string;
  domain: string;
  problemStatement: string;
  isCustomPS: boolean;
  leaderId: string;
  leaderName: string;
  leaderEmail: string;
  leaderPhone: string;
  leaderGithub: string | null;
  leaderCollege: string;
  members: TeamMemberDoc[];
  memberEmails: string[];
  status: TeamStatus;
  registrationLocked: boolean;
  adminNotes: string | null;
  isTimeLeapEligible: boolean;
  isTimeLeapQualified: boolean;
  isFinalist: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  verifiedAt: Timestamp | null;
  registrationLockedAt: Timestamp | null;
}

// ─── Rounds ───────────────────────────────────────────────────────────────────

export type RoundStatus =
  | 'Draft'
  | 'Published'
  | 'Active'
  | 'Locked'
  | 'Evaluation'
  | 'Completed'
  | 'Archived';

export type RoundType =
  | 'ppt'
  | 'mentor_session'
  | 'prototype'
  | 'timeleap'
  | 'final'
  | 'general';

export type SubmissionType =
  | 'ppt_link'
  | 'prototype_link'
  | 'github_link'
  | 'none';

/** Valid state transitions for rounds */
export const ROUND_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  Draft:      ['Published'],
  Published:  ['Draft', 'Active'],
  Active:     ['Locked'],
  Locked:     ['Evaluation'],
  Evaluation: ['Completed'],
  Completed:  ['Archived'],
  Archived:   [],
};

export interface RoundDoc {
  roundId: string;
  title: string;
  description: string;
  instructions: string;
  resources: string[];
  pptViewerLink: string | null;
  driveLink: string | null;
  canvaViewerLink: string | null;
  type: RoundType;
  status: RoundStatus;
  submissionType: SubmissionType;
  allowedTeams: 'all' | string[];
  startsAt: Timestamp | null;
  endsAt: Timestamp | null;
  submissionDeadline: Timestamp | null;
  timerDuration: number | null;
  googleSheetId: string | null;
  isVisible: boolean;
  updatedAt: Timestamp;
  updatedBy: string;
}

// ─── Submissions ──────────────────────────────────────────────────────────────

export type SubmissionStatus = 'Draft' | 'Submitted' | 'Locked' | 'Reviewed';

export interface SubmissionDoc {
  teamId: string;
  roundId: string;
  submittedBy: string;
  roundType: RoundType;
  submissionType: SubmissionType;
  // Content fields (populated based on submissionType)
  pptLink: string | null;
  prototypeLink: string | null;
  hasNoPrototype: boolean;
  githubLink: string | null;
  demoLink: string | null;
  status: SubmissionStatus;
  submittedAt: Timestamp;
  lockedAt: Timestamp | null;
}

// ─── Evaluations ──────────────────────────────────────────────────────────────

export interface EvaluationHistoryEntry {
  score: number;
  by: string;
  at: Timestamp;
  action: 'draft' | 'publish' | 'edit';
}

export interface EvaluationDoc {
  teamId: string;
  roundId: string;
  judgeUid: string | null;
  draftScore: number | null;
  publishedScore: number | null;
  isPublished: boolean;
  feedback: string | null;
  history: EvaluationHistoryEntry[];
  updatedAt: Timestamp;
  updatedBy: string;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardRoundDoc {
  roundId: string;
  isPublished: boolean;
  publishedAt: Timestamp | null;
  publishedBy: string | null;
  updatedAt: Timestamp;
}

export interface LeaderboardStandingDoc {
  teamId: string;
  teamName: string;
  score: number;
  rank: number;
  isTimeLeapQualified: boolean;
  isFinalist: boolean;
}

// ─── Mail Queue ───────────────────────────────────────────────────────────────

export type MailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'retry';
export type MailPriority = 'high' | 'normal' | 'low';

export type EmailTemplate =
  | 'otp'
  | 'leader_invitation'
  | 'member_invitation'
  | 'verified'
  | 'approved'
  | 'rejected'
  | 'need_changes'
  | 'reminder'
  | 'admin_invite'
  | 'announcement';

export interface MailQueueDoc {
  to: string;
  template: EmailTemplate;
  variables: Record<string, string | number>;
  status: MailStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: Timestamp | null;
  sentAt: Timestamp | null;
  failedAt: Timestamp | null;
  error: string | null;
  messageId: string | null;
  priority: MailPriority;
  createdAt: Timestamp;
  scheduledFor: Timestamp | null;
  createdBy: string;
}

// ─── Google Sheets Sync Queue ─────────────────────────────────────────────────

export type SheetsSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'retry';

export interface GoogleSheetsSyncDoc {
  sheetId: string;
  sheetName: string;
  teamId: string;
  teamName: string;
  roundId: string;
  data: Record<string, string | number>;
  status: SheetsSyncStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: Timestamp | null;
  syncedAt: Timestamp | null;
  error: string | null;
  createdAt: Timestamp;
  createdBy: string;
}

// ─── Mentor Slots ─────────────────────────────────────────────────────────────

export type MentorSlotStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface MentorSlotDoc {
  roundId: string;
  mentorName: string;
  mentorUid: string | null;
  teamId: string;
  teamName: string;
  scheduledFor: Timestamp;
  durationMins: number;
  meetLink: string;
  meetLinkVisibleAt: Timestamp;
  status: MentorSlotStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Judges ───────────────────────────────────────────────────────────────────

export interface JudgeDoc {
  uid: string | null;
  name: string;
  email: string;
  assignedTeams: string[];
  roundId: string;
  createdAt: Timestamp;
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export interface PermissionsDoc {
  userId: string;
  role: UserRole;
  canEditScores: boolean;
  canPublishScores: boolean;
  canManageRounds: boolean;
  canManageTeams: boolean;
  canSendEmails: boolean;
  canViewLogs: boolean;
  grantedBy: string;
  grantedAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Announcements ────────────────────────────────────────────────────────────

export interface AnnouncementDoc {
  title: string;
  message: string;
  createdBy: string;
  updatedBy: string | null;
  timestamp: Timestamp;
  updatedAt: Timestamp | null;
  isVisible: boolean;
  version: number;
  channels: {
    portal: boolean;
    email: boolean;
    discord: boolean;
    whatsapp: boolean;
  };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface PlatformSettings {
  hackathonName: string;
  hackathonTagline: string;
  hackathonDate: string;
  registrationOpen: boolean;
  currentPhase: string;
  contactEmail: string;
  discordWebhookUrl: string | null;
  whatsappApiToken: string | null;
  predefinedProblemStatements: string[];
  predefinedDomains: string[];
  maintenanceMode: boolean;
  emergencyMode?: boolean;
  registrationsPaused?: boolean;
  submissionsPaused?: boolean;
  emailsPaused?: boolean;
  sheetsPaused?: boolean;
  announcementsPaused?: boolean;
  portalBaseUrl: string;
}

// ─── Activity Logs ────────────────────────────────────────────────────────────

export interface ActivityLogDoc {
  userId: string;
  teamId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  at: Timestamp;
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export type AuditAction =
  // Auth
  | 'auth.otp_requested'
  | 'auth.otp_verified'
  | 'auth.user_created'
  // Teams / Registration
  | 'team.import_batch_created'
  | 'team.draft_edited'
  | 'team.invitation_sent'
  | 'team.leader_registered'
  | 'team.members_invited'
  | 'team.member_registered'
  | 'team.registration_locked'
  | 'team.verified'
  | 'team.profile_submitted'       // legacy, keep for backward compat
  | 'team.updated'
  | 'team.approved'                // legacy
  | 'team.rejected'                // legacy
  | 'team.need_changes'
  | 'team.member_removed'
  | 'team.member_added'
  | 'team.timeleap_eligible_set'
  | 'team.finalist_set'
  | 'team.deleted'
  // Rounds
  | 'round.created'
  | 'round.updated'
  | 'round.transition'             // replaces 'round.activated' — stores from/to status
  | 'round.session_assigned'       // was misused as 'round.activated'
  // Submissions
  | 'submission.submitted'
  | 'submission.updated'
  | 'submission.locked'
  // Evaluations
  | 'evaluation.draft_score_entered'
  | 'evaluation.score_published'
  // Leaderboard
  | 'leaderboard.published'
  | 'leaderboard.score_updated'    // legacy
  // Announcements
  | 'announcement.created'
  | 'announcement.updated'
  | 'announcement.deleted'
  // Email Queue
  | 'mail.job_created'
  | 'mail.job_processed'
  | 'mail.job_failed'
  // Admin Operations
  | 'admin.created'
  | 'admin.role_changed'
  | 'admin.permission_changed'
  | 'admin.score_permission_changed' // legacy
  | 'sheets.sync'
  // Tickets
  | 'ticket.created'
  | 'ticket.replied'
  | 'ticket.closed'
  // Settings
  | 'settings.updated';
