# DECISIONS.md — RevengersHack Backend

All non-trivial architectural decisions are logged here with rationale.
Future developers and the migration path to Cloud Functions both depend on this.

---

## D-001 — Next.js API Routes instead of Firebase Cloud Functions

**Date:** 2026-07-01  
**Decision:** All server-side business logic is implemented as Next.js API Routes
(`/app/api/**`) using the Firebase Admin SDK. Cloud Functions are NOT used.

**Rationale:**  
The Firebase project runs on the **Spark (free) plan**. Cloud Functions that
make outbound network calls (e.g., sending emails via Brevo/Resend) require the
**Blaze (pay-as-you-go) plan**, which is not enabled. Next.js API Routes on
Vercel's free tier handle the same workload without requiring a plan upgrade.

**Migration seam:**  
All business logic is isolated in `/server/services/` as framework-agnostic
TypeScript functions. API Route handlers are thin wrappers that call services.
When Blaze is enabled, the service functions can be lifted into Cloud Functions
with only the wrapper layer changing — service logic never imports from
`next/server` or any Next.js-specific module.

---

## D-002 — Option A Architecture (Standalone Backend)

**Date:** 2026-07-01  
**Decision:** The backend is a standalone Next.js app at `/backend-nextjs/`,
deployed to Vercel. The existing Vite frontend calls this backend's API routes.

**Rationale:**  
The existing Vite + vanilla JS frontend is already deployed on Firebase Hosting
and is not being rewritten. Adding a Next.js monorepo would require migrating
the entire frontend, which is out of scope for Phase 0. Option A lets backend
development proceed independently.

**CORS:** The backend allows requests from known origins only
(`https://sthack-88def.web.app`, `https://revengershack.tech`, `localhost:5173`
in dev).

---

## D-003 — Email Provider: Resend (primary), Brevo (fallback stub)

**Date:** 2026-07-01  
**Decision:** Resend is the primary email provider. The email service is
abstracted behind `/server/services/email.service.ts` so the provider can be
swapped without touching call sites.

**Rationale:** Resend has a simpler REST API, first-class TypeScript SDK, and a
generous free tier (100 emails/day, 3000/month). Brevo stubs are left in the
service interface comments for easy swap.

---

## D-004 — OTP stored in Firestore (not in-memory / Redis)

**Date:** 2026-07-01  
**Decision:** OTP codes are stored as documents in a server-only `OtpCodes`
Firestore collection with a `expiresAt` timestamp. They are written and deleted
exclusively via Admin SDK from API routes — Firestore Security Rules deny all
client access to this collection.

**Rationale:**  
No Redis/Memcached is available on the Spark plan. Firestore with TTL-style
expiry (checked at verification time, cleaned up by periodic admin writes) is
the only persistent server-side store available for free. The rate limit counter
(`OtpRateLimits` doc) lives in the same collection family.

---

## D-005 — Role system is generic (not hardcoded to 2 roles)

**Date:** 2026-07-01  
**Decision:** Roles are stored as a string field `role` on `Users` documents.
The auth middleware accepts a `requiredRoles: string[]` parameter for
role-checking, making it trivial to add `judge`, `mentor`, `organizer` etc.
without refactoring.

**Current valid roles:** `participant_leader`, `participant_member`, `admin`, `super_admin`

---

## D-006 — No physical/offline features

**Date:** 2026-07-01  
**Decision:** This is a 100% online hackathon. QR check-in, venue attendance
tracking, and offline modes are explicitly excluded from the schema, API routes,
and UI. If any such feature is requested in future, it must be documented here
before scaffolding.

---

## D-007 — TypeScript strict mode, no `any` without comment

**Date:** 2026-07-01  
**Decision:** `tsconfig.json` uses `"strict": true`. Any use of `any` type
requires an inline comment explaining why a more specific type is not feasible.
ESLint rule `@typescript-eslint/no-explicit-any` is set to `warn` (not `error`)
to allow justified uses with comments.

---

## D-008 — Firebase Admin SDK singleton pattern

**Date:** 2026-07-01  
**Decision:** Admin SDK is initialized once via a singleton in
`/lib/firebase-admin.ts` using a guard `getApps().length === 0`. This is
required for Next.js hot-reload safety — re-initializing on every module load
would create duplicate app instances.

**Service account:** The service account JSON is never committed. It is provided
as a single env var `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` (stringified JSON) or
as individual `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`,
`FIREBASE_ADMIN_PRIVATE_KEY` vars for deployment platforms that don't support
multi-line secrets well.

---

## D-009 — Firestore free-tier quota discipline

**Date:** 2026-07-01  
**Decision:** Free tier limits: 50K reads / 20K writes / 20K deletes per day,
1 GiB storage. Rules enforced:
- All list queries must use `limit()` — no unbounded collection scans.
- Real-time `onSnapshot` listeners are preferred over repeated `getDocs` for
  frequently-updated data (rounds, announcements).
- Notifications and audit logs are paginated at 20 items per page.
- CSV import for team invitations is chunked at 50 docs per Firestore batch
  write (Firestore batch limit is 500 but 50 is safer for quota budgeting).

---

## D-010 — Firebase Storage strict size caps

**Date:** 2026-07-01  
**Decision:** File upload caps enforced both client-side (UI validation) and
server-side (Storage security rules + API route size check):
- Resume: ≤ 5 MB
- Profile photo: ≤ 2 MB
- College ID: ≤ 2 MB
Free tier: 5 GB storage, 1 GB/day download bandwidth. With ~40 teams × ~5 files
× avg 2 MB = ~400 MB maximum — comfortably within free tier.
