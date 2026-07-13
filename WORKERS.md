# Hybrid Worker Architecture Documentation

This project uses a **hybrid worker architecture** to process background tasks (Mail Queue, Timeline Scheduler, and Google Sheets Synchronization) without depending on paid Vercel Cron plans. 

## Workflow Execution (.github/workflows/workers.yml)
A GitHub Actions workflow is scheduled to run every **5 minutes** to sequentially invoke the backend worker API endpoints. 

### GitHub Secrets Configuration
To enable the GitHub Actions workflow, you must configure the following Secrets in your GitHub Repository settings (`Settings > Secrets and variables > Actions`):

1. **`API_URL`**: The fully qualified domain of your deployed Next.js backend on Vercel (e.g., `https://revengershack-api.vercel.app`). Do not include a trailing slash.
2. **`CRON_SECRET`**: A cryptographically secure random string (e.g., generated via `openssl rand -hex 32`) matching the `CRON_SECRET` environment variable configured on your Vercel deployment.

---

## Worker Endpoints & Authentication

### Internal Endpoints (GitHub Actions / Curl triggers)
These endpoints are invoked by the GitHub Actions cron runner and are secured strictly by `CRON_SECRET`:
- **Mail Worker**: `POST /api/internal/mail-worker` (requires `X-Cron-Secret: <CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`)
- **Scheduler Worker**: `POST /api/internal/scheduler-worker` (requires `Authorization: Bearer <CRON_SECRET>`)
- **Sheets Worker**: `POST /api/internal/sheets-worker` (requires `X-Cron-Secret: <CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`)

### Manual Admin Endpoints (Admin Panel triggers)
These endpoints are designed for direct invocation from the Admin Panel and are secured via Firebase ID Token authentication (restricted to `super_admin` role only):
- **Mail Worker Manual Run**: `POST /api/admin/workers/mail/run`
- **Scheduler Worker Manual Run**: `POST /api/admin/workers/scheduler/run`
- **Sheets Worker Manual Run (Sync)**: `POST /api/admin/google-sheets/sync`

---

## Reliability Features

### 1. Retry Handling
Each step in the GitHub Actions runner utilizes curl's native retry capability to recover from temporary network drops or gateway errors:
- `--retry 3`: Automatically retries up to 3 times on transient errors.
- `--retry-delay 5`: Delays retry attempts by 5 seconds.

### 2. Connection and Request Timeouts
To prevent hanging processes from exhausting runner limits or Vercel execution timeouts:
- `--connect-timeout 10`: Limits connection establishment to 10 seconds.
- `--max-time 30`: Limits total request execution duration to 30 seconds.

### 3. Fail-safe Sequencer (Continue on Error)
The workflow step runs include `continue-on-error: true`. If a worker endpoint fails (e.g. returns a 500 error or times out), the runner logs the error details (`--fail-with-body`) but continues to invoke subsequent worker steps. One worker failure never blocks others from executing.
