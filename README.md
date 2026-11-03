# CherryLink by DTI

**Version:** v0.1 engineering foundation (NOT a production-complete v1.0)  
**Status:** initial engineering source, schema and publishing adapters; GitHub CI build + 7 unit tests passing, live Meta proof and deployment sign-off pending  
**Owner:** Digital To Infinity  
**Date:** 3 November 2026

CherryLink is a multi-workspace Facebook Page and Instagram professional-account scheduler. The backend/worker are independent from the browser. All posting jobs are durably persisted in PostgreSQL; there are no frontend timers and no hardcoded social accounts.

## Architecture

```
apps/web     Vite/React/TypeScript/Tailwind + shadcn-style components
apps/api     Express/TypeScript, Auth, OAuth, Composer, Media, Admin API
apps/worker  Persistent delivery claims, provider adapters, retries, reconciliation groundwork
packages/shared  Shared schemas, statuses, retry policy
packages/server  Postgres, Supabase, AES-GCM credentials, Meta Graph client
supabase/migrations  Workspace-isolated PostgreSQL schema and RLS
```

```
Web app -> API (Supabase Auth JWT) -> Supabase PostgreSQL & private Storage
                                     ^
Always-on worker ---------------------|
         |                 |
         +--> Facebook Page APIs / Instagram Graph APIs
```

## Mandatory prerequisites

1. A **new CherryLink-only** Supabase project. Do not reuse the CRM's schema or Supabase project.
2. Node.js 22+, npm 10+, and FFmpeg/FFprobe for video inspection.
3. Meta Developer app owned by an appropriate Business portfolio; `Facebook Login for Business` configurations for Pages and Instagram Unified Login. Exact configuration depends on your app dashboard.
4. DTI-authorized Facebook Page with `CREATE_CONTENT` Page task; Instagram Business/Creator account accessible to the app; server-side credentials.
5. An always-on worker host (VPS, worker service or dedicated container), PostgreSQL connection and an HTTPS public API origin.

## Local development

```bash
cp .env.example .env
# Fill required variables in .env; use a fresh Supabase project.
npm install
# Save generated package-lock.json before production deployment.
# Apply migrations in order using your Supabase SQL editor:
#   0001_cherrylink.sql
#   0002_connection_sessions.sql
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open `http://localhost:5173`. Enter a team member email, follow the Supabase magic link, and create a workspace. The workspace creator is an Admin. Local Meta redirects must be listed EXACTLY in Meta's OAuth redirect settings. Set `LIVE_PUBLISHING_ENABLED=false` while developing; scheduling will remain saved but the worker will not call Meta.

> Each `npm run dev:*` is a separate terminal. The first run builds shared libraries; rerun `npm run build:libs` after changing shared/server package source.

## Production

Use `npm run build`, deploy the API and worker as separate always-on services, and deploy the web app as a static site. The worker is not a cronjob or a browser background task. Set all secrets in the deployment secret manager; never commit `.env`. Publish HTTPS endpoints with exact OAuth callback URLs. The worker's `LIVE_PUBLISHING_ENABLED` flag is a safety gate: **do not enable until Milestone 0 genuine tests succeed**.

Deployment recipes: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Meta setup: [docs/META_SETUP.md](docs/META_SETUP.md). Acceptance status: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). Threats and controls: [docs/SECURITY.md](docs/SECURITY.md).

## Environment keys

See `.env.example`. `TOKEN_ENCRYPTION_KEY_BASE64` must decode to exactly 32 random bytes. Generate locally with `openssl rand -base64 32`. `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET` and encrypted access tokens must never be placed in frontend environment variables. Public Vite keys are safe to expose ONLY if they are the intended public anon/publishable keys.

## Current support and limits

- Auth/workspaces; Admin and Editor enforcement; magic-link login; team invitations; private uploads; JPEG normalization; basic MP4 inspection; captions; multiple target selection; drafts; schedule and reschedule; cancellation; history, calendar, status UI.
- Facebook publishing adapters: text, photo and Page Reel session-based upload. Instagram: image and Reel container-based publishing. **These API adapters have not yet passed a real DTI Meta test.**
- Unsupported for now: carousels, analytics, ad management, inbox, AI generation, edit of media/platform selection on an existing post, approval workflow, fully automatic Unified Login asset discovery across every Meta portfolio configuration, proactive token refresh, and platform-webhook reconciliation.
- Ambiguous outcomes become `UNKNOWN`, not an automatic retry; some cases require a human to confirm Meta's published object. This is intentional duplicate prevention.
- This is **not** a certified production-complete SaaS release. See acceptance ledger before running unattended.

## Meta developer URLs

- [Meta Developer dashboard](https://developers.facebook.com/apps/)
- [Meta Facebook API Postman workspace](https://www.postman.com/meta/facebook/overview)
- [Meta Instagram API Postman workspace](https://www.postman.com/meta/instagram/overview)
- [Instagram Reels publishing](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing)
- [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog/)

The Graph API version is configurable through `META_GRAPH_VERSION`; the initial default is `v26.0`. Confirm version compatibility during the proof stage.
