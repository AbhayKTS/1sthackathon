# RevengersHack Backend API

Standalone Next.js 15 App Router backend for the RevengersHack Hackathon Management Platform.
Deployed to Vercel. Called by the Vite frontend hosted on Firebase Hosting.

See `DECISIONS.md` for all architectural decisions.  
See `SCHEMA.md` for the Firestore data model.

---

## Architecture

```
Option A — Standalone Backend
─────────────────────────────
Vite Frontend (Firebase Hosting)
        │
        │  REST API calls (Bearer token)
        ▼
Next.js Backend (Vercel)  ← this repo
  /app/api/**  (API Routes, thin wrappers)
        │
        ▼
  /server/services/**  (business logic — framework-agnostic, Admin SDK only)
        │
        ├── Firebase Admin SDK → Firestore
        ├── Firebase Admin SDK → Auth
        ├── Firebase Admin SDK → Storage
        └── Resend → Email
```

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 App Router |
| Language | TypeScript (strict) |
| Auth | Firebase Auth + Admin SDK token verification |
| Database | Firestore (Admin SDK, server-side only) |
| Storage | Firebase Storage (client SDK for uploads, Admin SDK for validation) |
| Email | Resend |
| Validation | Zod |
| Deployment | Vercel (free tier) |

---

## Local Development Setup

### 1. Prerequisites

- Node.js 20+
- A Firebase project (see below for service account setup)
- A Resend account (free tier, 100 emails/day)

### 2. Clone and Install

```bash
cd backend-nextjs
npm install
```

### 3. Environment Variables

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

**Firebase Admin SDK (choose one method):**

**Method 1 — Single JSON string (recommended for Vercel):**
1. Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key" → downloads a JSON file
3. Stringify the file: `JSON.stringify(require('./your-key.json'))`
4. Paste the result into `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`

**Method 2 — Individual vars:**
Copy `project_id`, `client_email`, `private_key` from the downloaded JSON into
the individual `FIREBASE_ADMIN_*` vars.

⚠️ **NEVER commit the service account JSON file or .env.local to git.**

**Firebase Client SDK:**
Firebase Console → Project Settings → Your apps → Web app config

**Resend:**
resend.com → API Keys → Create key → paste into `RESEND_API_KEY`

### 4. Run Dev Server

```bash
npm run dev
# Starts on http://localhost:3001
```

The Vite frontend dev server (port 5173) calls this backend at `http://localhost:3001`.

### 5. Test Health Endpoint

```bash
curl http://localhost:3001/api/health
# Expected: { "success": true, "data": { "status": "operational", ... } }
```

---

## Folder Structure

```
backend-nextjs/
├── app/
│   └── api/
│       ├── health/          route.ts    ← Phase 0: smoke test
│       ├── auth/
│       │   ├── request-otp/ route.ts    ← Phase 1
│       │   └── verify-otp/  route.ts    ← Phase 1
│       ├── team/
│       │   ├── submit/      route.ts    ← Phase 4
│       │   └── update/      route.ts    ← Phase 13
│       ├── admin/
│       │   ├── import-csv/  route.ts    ← Phase 2
│       │   ├── review-team/ route.ts    ← Phase 5
│       │   └── tickets/     route.ts    ← Phase 12
│       └── submission/
│           └── submit/      route.ts    ← Phase 9
├── server/
│   └── services/
│       ├── auth.service.ts             ← Phase 1
│       ├── email.service.ts            ← Phase 11
│       ├── audit.service.ts            ← Phase 0 (scaffold)
│       ├── team.service.ts             ← Phase 4
│       ├── invitation.service.ts       ← Phase 2
│       ├── submission.service.ts       ← Phase 9
│       ├── notification.service.ts     ← Phase 10
│       └── ticket.service.ts           ← Phase 12
├── lib/
│   ├── firebase-admin.ts              ← Admin SDK singleton (server-only)
│   ├── firebase-client.ts             ← Client SDK config
│   ├── api-helpers.ts                 ← withAuth, requireRole, apiError
│   ├── errors.ts                      ← Typed AppError classes
│   └── env.ts                         ← Zod env validation
├── types/
│   └── auth.ts                        ← UserRole, UserDoc types
├── docs/
│   └── phase-0-initialization.md
├── DECISIONS.md
├── SCHEMA.md
└── README.md
```

---

## Deployment (Vercel)

1. Push `backend-nextjs/` to a GitHub repo (or use the monorepo root)
2. Import into Vercel — set **Root Directory** to `backend-nextjs`
3. Add all env vars from `.env.local.example` to Vercel project settings
4. Deploy — Vercel auto-detects Next.js
5. Add the Vercel deployment URL to `ALLOWED_ORIGINS` in production env vars
6. Update the Vite frontend's `VITE_API_BASE_URL` to point to the Vercel URL

### Vercel Free Tier Limits
- 100 GB bandwidth/month
- Serverless function duration: 10s (Hobby plan)
- For long CSV imports (Phase 2), stream the response or chunk processing to stay under 10s

---

## Phase Progress

| Phase | Status | Description |
|---|---|---|
| 0 | ✅ Complete | Project init, scaffold, health route |
| 1 | 🔲 Not Started | OTP auth |
| 2 | 🔲 Not Started | Team invitation CSV import |
| 3 | 🔲 Not Started | Verification portal |
| 4 | 🔲 Not Started | Team completion |
| 5 | 🔲 Not Started | Admin review & approval |
| 6 | 🔲 Not Started | Participant dashboard shell |
| 7 | 🔲 Not Started | Announcements |
| 8 | 🔲 Not Started | Problem statements & resources |
| 9 | 🔲 Not Started | Submission system |
| 10 | 🔲 Not Started | Notifications |
| 11 | 🔲 Not Started | Email automation |
| 12 | 🔲 Not Started | Support tickets |
| 13 | 🔲 Not Started | Team self-service management |
| 14 | 🔲 Not Started | Admin analytics & audit |
| 15 | 🔲 Not Started | Testing, hardening, QA, deploy |
