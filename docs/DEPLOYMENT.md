# CherryLink — MySQL deployment runbook

## Deployment topology

- Frontend: HTTPS static React/Vite app (`VITE_API_URL=https://your-api-domain` at build time).
- API: Node.js/Express behind HTTPS, cookie sessions, MySQL, Meta OAuth callbacks, signed media endpoint.
- Worker: dedicated always-on Node service without public ingress; same MySQL and **same private media storage volume** as API.
- Database: independent MySQL 8 (InnoDB, UTC sessions); do not share a database with the DTI CRM.
- Media: persistent private filesystem (or later a compatible abstraction). Backup alongside MySQL.
- TLS: HTTPS at origin is mandatory for production cookie security and Meta media fetching.

## Setup

1. Install Node 22+, MySQL 8, FFmpeg/FFprobe. Configure an independent MySQL database and least-privileged runtime account. Run schema with a migration account, not the runtime credential.
2. Execute `mysql/migrations/0001_initial.sql` using the MySQL CLI with trigger DELIMITER blocks. Run `npm run mysql:check`.
3. Set `MYSQL_*`, `MEDIA_DIR`, `MEDIA_PUBLIC_BASE_URL`, `MEDIA_SIGNING_KEY`, `TOKEN_ENCRYPTION_KEY_BASE64`, `WEB_URL`, `CORS_ORIGIN`, and Meta keys in the secure runtime environment. Never commit `.env`.
4. Run `npm run build`. Deploy `node apps/api/dist/index.js` and `node apps/worker/dist/index.js` as independent restartable services (systemd, supervised containers, or a VPS process manager).
5. Keep `LIVE_PUBLISHING_ENABLED=false` until live, authorized end-to-end Meta tests pass.
6. Verify cookie sessions, admin bootstrap, workspace isolation, media upload/preview, signed HTTPS fetch from an external network, and the Meta OAuth callback URL settings. Prove unattended publishing with the browser closed.
7. Monitor worker heartbeats, due jobs, statuses (`UNKNOWN` must trigger human review), Meta rate limits, database connection failures and filesystem availability.

## Media and workers

Media paths are relative to `MEDIA_DIR`, which must be the same durable path for API and worker. When deploying API and worker to **different hosts**, a shared persistent POSIX-compatible volume or an implemented compatible object-storage adapter is mandatory; local unshared disks will break publishing. `MEDIA_PUBLIC_BASE_URL` must point to the API's publicly reachable HTTPS address, not localhost.

Multiple workers claim due jobs using MySQL `FOR UPDATE SKIP LOCKED`, with a per-account lease row and heartbeat renewal. On crash, expired `RUNNING` jobs are moved to `UNKNOWN` to avoid replaying an ambiguous Meta final publish request. They are not silently retried.

## Backups / recovery

Take encrypted and tested MySQL backups plus private media volume snapshots. Store `TOKEN_ENCRYPTION_KEY_BASE64` in a separate recovery-safe secret manager; without it stored provider tokens cannot be decrypted. On restore use `LIVE_PUBLISHING_ENABLED=false`, reconcile old scheduled jobs before enabling publishing, then restore worker safely.

## Local Docker

`compose.mysql.yml` provides development-only MySQL service. `Dockerfile` supports API and worker images; attach the same private media volume to both containers. `Dockerfile.web` builds the frontend without any third-party authentication variables.

This runbook is not evidence that deployment or live Meta publication has succeeded.
