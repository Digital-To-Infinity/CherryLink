# CherryLink MySQL migration — acceptance ledger

| Scope | Status | Gate |
|---|---|---|
| React web UI and MySQL password login | CODED | Must verify actual MySQL-backed login on local/production browsers |
| SQL schema / foreign keys / status triggers | CI VERIFIED (MySQL 8.4) | Migration imported; immutable PUBLISHED-state trigger tested |
| MySQL workspace and team permissions | BASIC CI VERIFIED | HTTP login, workspace creation, draft, team invitation and Editor role checks passed; broader cross-workspace tests pending |
| MySQL media storage and signed URL | CODED | Verify private upload and external HTTPS fetch |
| Meta Page / Instagram OAuth adapters | CARRIED FORWARD | Actual credentials/permissions and live asset discovery need proof |
| Photo + Reel Meta publishing | CARRIED FORWARD | Live DTI test posts needed; not simulated |
| Scheduler with MySQL job and account locks | CODED | Concurrency, worker restart, duplicate prevention tests needed |
| Build, unit and selected integration tests | CI PASSED (9/9) | GitHub Actions push and PR at commit 0d6e45ab; MySQL 8.4 import, mysql:check, HTTP integration test passed |
| Production unattended scheduling | NOT TESTED | Worker health, job recovery, browser-closed publishing |
| Security and deployment sign-off | PENDING | Secrets, TLS, backups, negative tests, monitoring |

All actual Meta publishing must remain disabled until the approved live tests are complete. An unverified published state is NEVER considered a success.
