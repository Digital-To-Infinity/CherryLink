# Deployment runbook (not yet deployed)

## Topology

- **Frontend:** HTTPS static hosting for `apps/web/dist`. Environment `VITE_API_URL`, `VITE_SUPABASE_URL` and **public** `VITE_SUPABASE_ANON_KEY` are injected at *build* time.
- **API:** Always-on Node service, public HTTPS reverse proxy, health `/healthz`, readiness `/readyz`, auth and OAuth callbacks.
- **Worker:** Independent always-on Node service using the same database/storage and encryption key. Private network preferred; no public ingress needed. `LIVE_PUBLISHING_ENABLED=false` until verified.
- **Database and storage:** new Supabase project, service-role key on server only; use project backups and regional requirements.

## Runtime

1. Install Node 22+, FFmpeg/FFprobe and npm dependencies. Run `npm install`, commit the generated lockfile when creating your own repository, then `npm run build`.
2. Apply `0001_cherrylink.sql` then `0002_connection_sessions.sql` to a **new isolated project**.
3. Set env vars in API and worker secret managers. Never set the service key, Graph secret or encryption key in `VITE_` variables.
4. Deploy API as `node apps/api/dist/index.js` and worker as `node apps/worker/dist/index.js`, with process restarts enabled.
5. Register exact Meta OAuth callback URLs, test sign-in, upload, account discovery and permissions in development mode. Use a valid HTTPS endpoint for Meta-fetchable media.
6. Run the acceptance checklist. Only after a real scheduled Facebook + Instagram post succeeds with the browser closed, set worker `LIVE_PUBLISHING_ENABLED=true` for approved accounts.
7. Monitor worker heartbeat (fresh under 3 minutes), database jobs due vs actual delivery, PUBLISHED/UNKNOWN counts, token health, API request errors, disk/memory and Meta rate-limit responses. Alert an on-call team member on stuck/UNKNOWN jobs.

## Example Docker targets

`Dockerfile` supports `SERVICE=api` or `SERVICE=worker`; this is a starter recipe, not a validated production deployment. Configure persistent secrets, environment-specific limits and restart policies. Web app static deployment may use `Dockerfile.web`.

## Worker restart and duplicate safety

Rows locked during the publish call are released after a crash, and their lease expires. Restarted workers quarantine stale `RUNNING` jobs as `UNKNOWN` instead of automatically repeating the Meta request. A human or a verified provider reconciliation flow must resolve the outcome before a retry. A correct scheduler prefers a visible unresolved delivery to a duplicate live post.

## Backup/restore drill

Take an encrypted PostgreSQL backup; verify at least one restore to a clean test environment. Maintain the private media bucket and token encryption key according to retention policies. Do not restore scheduled jobs into a live worker without a reconciliation/fencing run, as old jobs could republish.

## Push to a dedicated GitHub repository

The connected `Digital-To-Infinity` organization currently does not expose a CherryLink repository to the development connector. Create a **new private repository** named `CherryLink` in that organization, leaving the existing CRM and website repositories untouched. Then clone/init in this extracted folder and push a reviewed branch:

```bash
git init
git switch -c main
git add .
git commit -m "Initial CherryLink foundation"
git remote add origin https://github.com/Digital-To-Infinity/CherryLink.git
git push -u origin main
```

Alternatively, create an empty repository in the GitHub UI and share access with the connected GitHub app. Do not commit `.env`, secrets or access tokens. Use protected main and PR branches for subsequent milestones.
