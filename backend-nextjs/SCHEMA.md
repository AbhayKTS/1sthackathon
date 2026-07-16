# SCHEMA.md — RevengersHack Firestore Schema

Living document. Updated as each conflict in DATA_WORKFLOW.md is resolved.
Last updated: 2026-07-05 — Batch 1 reconciliation pass (aligned all field names to actual code).

> **IMPORTANT:** This file must be kept in sync with `/docs/DATA_WORKFLOW.md`.
> Field names here reflect what the **code actually writes to Firestore**, not the original design spec.
> When in doubt, trust the code over this document.

---

## Naming Conventions

- Collection names: `camelCase` (e.g., `users`, `teams`, `invitedTeams`) — matches existing Vite frontend
- Field names: `camelCase`
- Timestamps: always `Timestamp` (Firestore native), never `Date` or `number`
- IDs that reference other docs: `<entity>Id` suffix (e.g., `teamId`, `userId`)
- Status fields: always a string enum — never a boolean (boolean can't express 3+ states)

---

## Collections

---

### `Users` — Phase 1

Stores all authenticated platform users.
Document ID: Firebase Auth UID

```typescript
{
  uid:            string;          // Firebase Auth UID (same as doc ID)
  email:          string;          // Verified email
  role:           'participant_leader' | 'participant_member' | 'admin' | 'super_admin';
  teamId:         string | null;   // Firestore ID of the Teams doc, null until assigned
  invitedTeamId:  string | null;   // Firestore ID of the InvitedTeams doc they came from
  displayName:    string | null;   // Optional display name set during verification
  phone:          string | null;   // Normalised mobile number
  whatsapp:       string | null;   // Normalised WhatsApp number
  college:        string | null;   // College name (added by onboarding)
  course:         string | null;   // Course/Branch (e.g. B.Tech CSE)
  gradYear:       number | null;   // Graduation Year
  linkedin:       string | null;   // LinkedIn URL
  github:         string | null;   // GitHub Username
  roleInTeam:     string | null;   // Technical role in team (e.g. Backend Developer)
  onboardingStatus: 'pending' | 'complete';
  createdAt:      Timestamp;
  updatedAt:      Timestamp;
  lastLoginAt:    Timestamp | null;
  isActive:       boolean;         // false = soft-banned/deactivated
}
```

**Security rule:** Read own doc only. All writes via Admin SDK (API route).

---

### `OtpCodes` — Phase 1

Server-only. Stores pending OTP codes for email verification.
Document ID: auto-ID

```typescript
{
  email:      string;     // The email the OTP was sent to
  codeHash:   string;     // SHA-256(otp + ':' + projectId pepper) — NEVER plain text
  expiresAt:  Timestamp;  // 10 minutes from issuance (written as JS Date, Firestore auto-converts)
  attempts:   number;     // Incremented on each failed verify attempt (max 5)
  used:       boolean;    // true once successfully verified
  createdAt:  Timestamp;
}
```

> **Note (CONFLICT #3-related):** Field was named `code` in the original spec. Actual code writes `codeHash`. RESOLVED 2026-07-05.

**Security rule:** NO client access. Admin SDK only.

---

### `OtpRateLimits` — Phase 1

Server-only. One doc per email tracking OTP request frequency.
Document ID: `email` (URL-encoded)

```typescript
{
  email:       string;
  count:       number;     // Requests in current window
  windowStart: Timestamp;  // Start of 1-hour rolling window
  lastRequest: Timestamp;
}
```

**Security rule:** NO client access. Admin SDK only.

---

### `InvitedTeams` — Phase 2

One doc per shortlisted team. Admin-created via CSV import.
Document ID: auto-ID

```typescript
{
  teamName:      string;
  leaderName:    string;
  leaderEmail:   string;       // Normalized to lowercase. The gate key for OTP gating.
  leaderPhone:   string;
  college:       string;
  // city, state, round — NOT written by current import service (CsvRow has no these fields)
  status:        'Draft' | 'Invited' | 'EmailSent' | 'LeaderRegistered' | 'MembersInvited' | 'Verified' | 'Locked';
  importBatchId: string;       // UUID from CSV import session (for idempotency)
  importedAt:    Timestamp;    // Written by invitation.service.ts on import
  updatedAt:     Timestamp;    // Updated on status transitions
  invitationSentAt: Timestamp | null;
  leaderRegisteredAt: Timestamp | null;
  allMembersRegisteredAt: Timestamp | null;
  lockedAt: Timestamp | null;
}
```

> **Note (CONFLICT #3):** Original spec had `invitedAt`, `emailSentAt`, `verifiedAt`, `city`, `state`, `round`. Actual code writes `importedAt` and `updatedAt` only. `status` enum expanded to match actual code states. RESOLVED 2026-07-15.

**Security rule:** Admin read/write only. No client access.

---

### `Teams` — Phase 4

One doc per team. Created when leader completes team profile.
Document ID: auto-ID

```typescript
{
  // Identity
  teamName:     string;
  invitedTeamId: string;          // FK → InvitedTeams

  // Team info
  domain:       string;
  trackId:      string | null;
  problemStatement: string;
  isCustomPS:   boolean;

  // Leader (denormalized for quick display)
  leaderId:     string;           // FK → Users.uid
  leaderName:   string;
  leaderEmail:  string;
  leaderPhone:  string;
  leaderWhatsapp: string;
  leaderCollege: string;
  leaderCourse: string;
  leaderGradYear: number;
  leaderGithub: string | null;
  leaderLinkedin: string | null;

  // Members array (leader NOT included here — leader is separate)
  members: Array<{
    uid:        string | null;    // null until they complete verification
    name:       string;
    email:      string;
    phone:      string;
    whatsapp:   string;
    course:     string;
    gradYear:   number;
    role:       string;
    college:    string;
    github:     string | null;
    linkedin:   string | null;
    joinedAt:   Timestamp | null;
    removedAt:  Timestamp | null; // null = active; set on removal (preserved for audit)
  }>;

  // Optional uploads (Firebase Storage paths, not URLs)
  resumeStoragePath:    string | null;  // leader resume
  photoStoragePath:     string | null;  // leader photo
  idStoragePath:        string | null;  // leader college ID

  memberEmails: string[];
  status:       'Draft' | 'Verified' | 'Submitted' | 'Approved' | 'Rejected' | 'Incomplete' | 'NeedChanges';
  registrationLocked: boolean;
  assignedJudgeUids: string[];          // default []
  assignedMentorUids: string[];         // default []
  adminNotes:     string | null;        // Latest admin note (Need Changes message)
  needChangesHistory: Array<{           // Append-only history, never overwritten
    note:       string;
    at:         Timestamp;
    byAdminUid: string;
  }>;

  // Scoring (for future judging/leaderboard)
  scores: Array<{                       // Empty until judging phase
    roundId:    string;
    score:      number;
    judgeUid:   string;
    at:         Timestamp;
  }>;

  // Timestamps
  createdAt:    Timestamp;
  updatedAt:    Timestamp;              // Used for optimistic locking in admin review
  submittedAt:  Timestamp | null;
  approvedAt:   Timestamp | null;
  rejectedAt:   Timestamp | null;

  // Stage 6e Flags
  isTimeLeapSelected: boolean;
  isTop10: boolean;
  isTop15: boolean;
}
```

**Security rule:** Leader/members can read own team only. All writes via Admin SDK.

---

### `Submissions` — Phase 9

One doc per submission attempt per round per team.
Document ID: `{teamId}_{roundId}` — composite deterministic ID enabling upsert

```typescript
{
  teamId:      string;   // FK → teams
  roundId:     string;   // FK → rounds
  submittedBy: string;   // FK → users.uid (leader only)

  // Submission content (currently supported fields)
  githubLink:  string;          // NOTE: spec originally said githubUrl
  demoLink:    string | null;   // NOTE: spec originally said demoUrl
  // pptUrl, videoUrl, docsUrl, notes — NOT written by current code (future fields)

  // Status
  status: 'Submitted';  // Only value written currently. 'Draft'/'Locked'/'Reviewed' reserved for future.

  // Judging — future-ready, not yet written
  // scores: Array<{ judgeUid, score, comment, at }>;

  submittedAt: Timestamp;
  // lockedAt, updatedAt — NOT written by current code
}
```

> **Note (DATA_WORKFLOW.md):** Field names changed from spec — `githubUrl` → `githubLink`, `demoUrl` → `demoLink`. Document ID is composite `{teamId}_{roundId}`, not auto-ID. RESOLVED 2026-07-05.

**Security rule:** Team leader can create/update own submission before deadline. Admin can update. Reads: own team only.

---

### `Rounds` — Phase 6 (Dynamic)

Replaces fixed `round-1` approach. Defines round type, timing, and submission sheet.
Document ID: `roundId` (e.g. `round-1`, `timeleap`)

```typescript
{
  roundId:            string;
  title:              string;
  description:        string;
  type:               'ppt' | 'mentoring_prototype' | 'timeleap' | 'judges_final' | 'general';
  isActive:           boolean;           // Controls visibility of submission form on dashboard
  isLocked:           boolean;           // If true, submissions are locked (read-only mode)
  startsAt:           Timestamp | null;
  endsAt:             Timestamp | null;
  submissionDeadline: Timestamp | null;
  googleSheetId:      string | null;     // Defines where submissions are written
  updatedAt:          Timestamp;
  updatedBy:          string;            // Admin UID who last modified
}
```

**Security rule:** Any authenticated user can read. All writes via Admin SDK.

---

### `Sessions` — Phase 6c

Schedules mentor/judge sessions for a team in a specific round.
Document ID: `{teamId}_{roundId}_{type}`

```typescript
{
  sessionId:    string;
  teamId:       string;
  roundId:      string;
  type:         'mentoring' | 'judging';
  hostName:     string | null;
  hostUid:      string | null;
  meetLink:     string | null;
  scheduledFor: Timestamp | null;
  updatedAt:    Timestamp;
  updatedBy:    string;
}
```

**Security rule:** Authenticated user can read own team's sessions. Writes via Admin SDK.

---

### `Leaderboard` — Phase 6d

Computed standings for a specific round based on judges' scores.
Document ID: `roundId`

```typescript
{
  roundId:      string;
  standings:    Array<{
    teamId:     string;
    teamName:   string;
    score:      number;
    rank:       number;
  }>;
  updatedAt:    Timestamp;
  updatedBy:    string;
}
```

**Security rule:** Any authenticated user can read. Writes via Admin SDK.

---

### `Announcements` — Phase 7 (existing, to be formalized)

Document ID: auto-ID

```typescript
{
  title:      string;
  message:    string;
  createdBy:  string;          // Admin UID
  updatedBy:  string | null;
  timestamp:  Timestamp;       // Creation time. NOTE: spec said createdAt — actual field is timestamp.
  updatedAt:  Timestamp | null;
  isVisible:  boolean;         // Soft-delete / hide without removing
  version:    number;          // Incremented on each edit
}
```

> **Note (DATA_WORKFLOW.md):** Creation timestamp field is `timestamp`, NOT `createdAt`. Any sort by `createdAt` will fail silently. RESOLVED 2026-07-05.

**Subcollection `ReadState`** (per announcement):
```typescript
// Path: announcements/{annId}/ReadState/{userId}
{
  readAt: Timestamp;
}
```

**Security rule:** Any authenticated user can read. Create/update via Admin SDK only.

---

### `Notifications` — Phase 10

One doc per notification per user.
Document ID: auto-ID

```typescript
{
  userId:     string;   // FK → users.uid (recipient)
  type:       'system_alert' | 'team_approved' | 'team_rejected' | 'team_need_changes' | 'submission_received' | 'support_reply';
  title:      string;
  message:    string;   // NOTE: spec said `body` — actual field is `message`
  actionLink: string | null;
  isRead:     boolean;
  createdAt:  Timestamp;
  // refId, refType, readAt — NOT written by current code (future fields)
}
```

> **Note (DATA_WORKFLOW.md):** Field `body` renamed to `message` in actual code. `refId`, `refType`, `readAt` not written. `type` enum updated to match notification.service.ts values. RESOLVED 2026-07-05.

> **Known gap:** `createTeamNotification()` currently only notifies the team leader, not members. See CONFLICT #9 in DATA_WORKFLOW.md — OPEN.

**Security rule:** User can read/update own notifications only (mark isRead). Only Admin SDK can create.

---

### `AuditLogs` — Phase 5 (created alongside admin actions)

Append-only. Never updated or deleted.
Document ID: auto-ID

```typescript
{
  action:     string;         // e.g., 'team.approve', 'team.reject', 'round.activate', 'otp.verify'
  actorUid:   string;         // Who performed the action
  actorRole:  string;
  targetId:   string | null;  // The affected document ID
  targetType: string | null;  // Collection name of the target
  metadata:   Record<string, unknown>; // Action-specific payload (sanitized, no PII)
  ip:         string | null;  // Request IP (hashed or truncated for privacy)
  at:         Timestamp;
}
```

**Security rule:** Admin/super_admin can read (paginated). NO writes from client — Admin SDK only.

---

### `EmailLogs` — Phase 11

Document ID: auto-ID

```typescript
{
  to:        string;          // Email address recipient. NOTE: spec said `recipient`.
  template:  string;          // Template name (e.g., 'invitation', 'otp', 'approved', 'rejected', 'needChanges')
  success:   boolean;         // true = send succeeded. NOTE: spec said status enum 'Sent'/'Failed'/'Bounced'.
  error:     string | null;   // Error message if failed, null on success
  messageId: string | null;   // Provider-assigned message ID
  timestamp: Timestamp;       // Log creation time. NOTE: spec said `sentAt`.
  // provider, retries, failedAt — NOT written by current code
}
```

> **Note (CONFLICT #4):** Entire field shape differs from original spec. `recipient` -> `to`, `status (enum)` -> `success (boolean)`, `sentAt` -> `timestamp`. Provider/retries/failedAt not tracked. RESOLVED 2026-07-05.

**Security rule:** Admin/super_admin read only. NO client writes.

---

### `tickets` — Phase 12

> **Note:** Collection is named `tickets` (lowercase), not `SupportTickets`. Messages are stored as an **embedded array** on the ticket document, NOT a subcollection. RESOLVED 2026-07-05.

Document ID: auto-ID

```typescript
{
  userId:    string;       // FK → users.uid. NOTE: spec said `submittedBy`.
  teamId:    string | null;
  subject:   string;
  category:  'Technical' | 'Submission' | 'General'; // NOTE: spec said `description` field + priority enum.
  status:    'Open' | 'Pending' | 'Resolved';         // NOTE: spec had 'InProgress'/'Closed' — actual has 'Pending'.
  messages:  Array<{                                  // Embedded array, NOT a subcollection.
    sender:     'user' | 'admin';
    senderUid:  string;
    senderName: string;            // Display name or email
    content:    string;
    timestamp:  string;            // ISO 8601 string, not Timestamp
  }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // priority, resolvedAt — NOT written by current code
}
```

> **Scalability note:** Embedded messages array will hit Firestore's 1MB document limit at high message volume. Acceptable at current hackathon scale. Migrate to subcollection if volume grows.

**Security rule:** User can read own tickets. Admin can read/update all. All writes via Admin SDK.

---

## Undocumented Collections (Exist in Production, Added Post-Spec)

### `joinGangLeads`

Landing-page interest form. Written directly by client SDK — no backend API route.
Document ID: auto-ID

```typescript
{
  name:      string;
  email:     string;
  number:    string;   // Phone number
  teamName:  string;
  source:    string;   // 'landing-page'
  createdAt: Timestamp;
}
```

**Note:** NOT in original spec. Sequential step BEFORE `invitedTeams` — these are leads organizers use to decide who to shortlist. No backend service currently reads this collection. See CONFLICT #6 in DATA_WORKFLOW.md.

---

## Future Collections (Reserved, Not Yet Implemented)

- `MentorSessions` — for future mentor booking
- `Certificates` — for future certificate automation
- `Judges` — for future judging panel
- `Leaderboard` — materialized view for performance (if judging is added)
