# SCHEMA.md — RevengersHack Firestore Schema

Living document. Updated as each phase is implemented.
Last updated: Phase 0 (scaffold only — no collections created yet).

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
  code:       string;     // Hashed OTP (never store plain text)
  expiresAt:  Timestamp;  // 10 minutes from issuance
  attempts:   number;     // Incremented on each failed verify attempt (max 5)
  used:       boolean;    // true once successfully verified
  createdAt:  Timestamp;
}
```

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
  teamName:           string;
  leaderName:         string;
  leaderEmail:        string;            // Used as the gate key for verification
  leaderPhone:        string;
  college:            string;
  city:               string | null;
  state:              string | null;
  status:             'Invited' | 'EmailSent' | 'EmailFailed' | 'Verified' | 'Expired';
  invitedAt:          Timestamp;
  emailSentAt:        Timestamp | null;
  verifiedAt:         Timestamp | null;
  importBatchId:      string;            // ID of the CSV import batch (for re-upload idempotency)
  round:              number;            // Which round they were shortlisted for (e.g., 2)
}
```

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
  college:      string;
  department:   string;
  year:         string;           // e.g., "3rd Year"
  state:        string;
  city:         string;

  // Leader (denormalized for quick display)
  leaderId:     string;           // FK → Users.uid
  leaderName:   string;
  leaderEmail:  string;
  leaderPhone:  string;
  leaderGithub: string | null;
  leaderLinkedin: string | null;

  // Members array (leader NOT included here — leader is separate)
  members: Array<{
    uid:        string | null;    // null until they complete verification
    name:       string;
    email:      string;
    phone:      string;
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

  // Status lifecycle
  status: 'Incomplete' | 'Submitted' | 'UnderReview' | 'Approved' | 'Rejected' | 'NeedChanges';
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
}
```

**Security rule:** Leader/members can read own team only. All writes via Admin SDK.

---

### `Submissions` — Phase 9

One doc per submission attempt per round per team.
Document ID: auto-ID

```typescript
{
  teamId:       string;           // FK → Teams
  roundId:      string;           // FK → Rounds
  submittedBy:  string;           // FK → Users.uid (leader only can submit)

  // Submission content
  githubUrl:    string;
  demoUrl:      string | null;
  pptUrl:       string | null;    // Public URL or Storage path
  videoUrl:     string | null;
  docsUrl:      string | null;
  notes:        string | null;

  // Status
  status: 'Draft' | 'Submitted' | 'Locked' | 'Reviewed';

  // Judging (future-ready)
  scores: Array<{
    judgeUid: string;
    score:    number;
    comment:  string | null;
    at:       Timestamp;
  }>;

  submittedAt:  Timestamp;
  lockedAt:     Timestamp | null;
  updatedAt:    Timestamp;
}
```

**Security rule:** Team leader can create/update own submission before deadline. Admin can update. Reads: own team only.

---

### `Rounds` — Phase 6 (existing, to be formalized)

Fixed doc IDs: `round-1`, `round-2`, `round-3`
Document ID: `round-{n}`

```typescript
{
  title:              string;
  description:        string;
  isActive:           boolean;
  submissionDeadline: Timestamp | null;  // Server-authoritative deadline for submissions
  startsAt:           Timestamp | null;
  endsAt:             Timestamp | null;
  updatedAt:          Timestamp;
  updatedBy:          string;            // Admin UID who last activated
}
```

**Security rule:** Any authenticated user can read. All writes via Admin SDK.

---

### `Announcements` — Phase 7 (existing, to be formalized)

Document ID: auto-ID

```typescript
{
  title:      string;
  message:    string;
  createdBy:  string;    // Admin UID
  updatedBy:  string | null;
  createdAt:  Timestamp;
  updatedAt:  Timestamp | null;
  isVisible:  boolean;   // Soft-delete / hide without removing
}
```

**Subcollection `ReadState`** (per announcement):
```typescript
// Path: Announcements/{annId}/ReadState/{userId}
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
  userId:     string;    // FK → Users.uid (recipient)
  type:       'Approval' | 'Rejection' | 'NeedChanges' | 'Announcement' | 'Submission' | 'Deadline' | 'Mentor';
  title:      string;
  body:       string;
  isRead:     boolean;
  refId:      string | null;   // ID of the related doc (e.g., annId, teamId)
  refType:    string | null;   // Collection name (e.g., 'Announcements', 'Teams')
  createdAt:  Timestamp;
  readAt:     Timestamp | null;
}
```

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
  recipient:  string;         // Email address
  template:   'invitation' | 'otp' | 'verified' | 'approved' | 'rejected' | 'needChanges' | 'reminder';
  status:     'Sent' | 'Failed' | 'Bounced';
  provider:   'resend' | 'brevo';
  messageId:  string | null;  // Provider message ID
  error:      string | null;  // Error message if failed
  retries:    number;
  sentAt:     Timestamp;
  failedAt:   Timestamp | null;
}
```

**Security rule:** Admin/super_admin read only. NO client writes.

---

### `SupportTickets` — Phase 12

Document ID: auto-ID

```typescript
{
  submittedBy:  string;       // FK → Users.uid
  teamId:       string | null;
  subject:      string;
  description:  string;
  status:       'Open' | 'InProgress' | 'Resolved' | 'Closed';
  priority:     'Low' | 'Medium' | 'High' | 'Urgent';
  createdAt:    Timestamp;
  updatedAt:    Timestamp;
  resolvedAt:   Timestamp | null;
}
```

**Subcollection `Messages`** (per ticket):
```typescript
// Path: SupportTickets/{ticketId}/Messages/{msgId}
{
  authorUid:  string;
  authorRole: string;
  body:       string;
  createdAt:  Timestamp;
}
```

**Security rule:** User can read/create own tickets. Admin can read/update all.

---

## Future Collections (Reserved, Not Yet Implemented)

- `MentorSessions` — for future mentor booking
- `Certificates` — for future certificate automation
- `Judges` — for future judging panel
- `Leaderboard` — materialized view for performance (if judging is added)
