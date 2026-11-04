# CherryLink by DTI — MySQL Edition

**Status:** Engineering implementation, not production-certified. Supabase is not required.
CherryLink schedules Facebook Page and Instagram professional-account posts with an always-on Node worker, independent of your browser.

## Stack

- `apps/web` — React 19 + Vite + TypeScript + Tailwind
- `apps/api` — Express / TypeScript, MySQL password sessions, Meta OAuth, private media handling
- `apps/worker` — independent queue consumer with MySQL InnoDB row locks and per-account leases
- `packages/server` — mysql2 connection pool, password hashing, credential encryption, signed media URLs
- `mysql/migrations` — MySQL 8 InnoDB schema + status integrity triggers
- **No** Supabase SDK, Supabase Auth, Postgres driver or hosted storage dependency.

## 1. Prerequisites

Node.js 22+, npm 10+, MySQL **8.0+** (8.4 recommended), and FFmpeg/FFprobe in PATH. Do not reuse any DTI CRM database.

Optional local database using Docker:

```bash
cp .env.example .env
# Fill MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, MEDIA_SIGNING_KEY and TOKEN_ENCRYPTION_KEY_BASE64
docker compose -f compose.mysql.yml up -d
```

On Windows PowerShell use `Copy-Item .env.example .env`. If using Hostinger MySQL, create a dedicated CherryLink database/user with only privileges required by the application. Confirm that your database version supports `FOR UPDATE SKIP LOCKED`.

## 2. Create the MySQL schema

Import **once into an empty database** using MySQL CLI (from cmd/bash):

```bash
mysql -h 127.0.0.1 -P 3306 -u cherrylink -p cherrylink < mysql/migrations/0001_initial.sql
```

PowerShell (if mysql client is in PATH):

```powershell
cmd /c "mysql -h 127.0.0.1 -P 3306 -u cherrylink -p cherrylink < mysql/migrations/0001_initial.sql"
```

The `mysql` client accepts the DELIMITER blocks required for audit/status triggers. For hosted MySQL replace host, username and database.

## 3. Environment

Only **one** repository-root `.env` is necessary. Generate random secrets locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use first output for `MEDIA_SIGNING_KEY`, second for `TOKEN_ENCRYPTION_KEY_BASE64`. Do not paste these in GitHub or share them in chat. Fill `MYSQL_*` variables. The public frontend contains only `VITE_API_URL`; database and Meta secrets never enter the browser.

Set `MEDIA_DIR` to a private, persistent directory shared by API and worker. `MEDIA_PUBLIC_BASE_URL` must be an externally reachable HTTPS API origin before live Meta image/Reel publishing. HTTP on 127.0.0.1 is only for local UI development.

## 4. Install and create your first admin

```bash
npm install
npm run mysql:check
```

First administrator account is deliberately created by the owner, not by an unauthenticated signup endpoint.

PowerShell (set a strong unique temporary password):

```powershell
$env:CHERRYLINK_ADMIN_EMAIL="your-email@example.com"
$env:CHERRYLINK_ADMIN_PASSWORD="YOUR_UNIQUE_12_PLUS_CHARACTER_PASSWORD"
npm run admin:create
Remove-Item Env:CHERRYLINK_ADMIN_EMAIL
Remove-Item Env:CHERRYLINK_ADMIN_PASSWORD
```

Do not reuse other DTI passwords. Do not put these admin bootstrap variables in `.env` or source control. Avoid exposing actual credentials in shared terminal history/screenshots.

## 5. Run locally in three VS Code terminals

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

Visit **http://127.0.0.1:5173**. Sign in using the administrator email/password; create the CherryLink workspace. The worker is intentionally disabled from live Meta publishing (`LIVE_PUBLISHING_ENABLED=false`) until authorized Meta proofs succeed.

Users can be invited from Team. Without an email provider, the admin copies a 7-day one-time invite link and shares it privately. A new teammate sets their own password.

API liveness: `http://127.0.0.1:3001/healthz`.
API readiness (MySQL): `http://127.0.0.1:3001/readyz`.

## 6. What still needs production validation

The MySQL implementation must be checked against a real MySQL server, including migrations/triggers, two simultaneous workers, lease expiry/recovery, disconnections, tenant isolation, OAuth, Meta image + Reel publishing and an unattended schedule. The Graph API adapters remain unverified against live DTI assets. Review `docs/ACCEPTANCE.md` before deploying.

## Production operational guidance

See [deployment](docs/DEPLOYMENT.md), [Meta setup](docs/META_SETUP.md), and [security](docs/SECURITY.md). The API, worker and media volume must survive process restarts. Do not set `LIVE_PUBLISHING_ENABLED=true` without real Meta test evidence.
