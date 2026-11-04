# CherryLink MySQL migration — acceptance ledger

| Scope | Status | Gate |
|---|---|---|
| React web UI and MySQL password login | CODED | Must verify actual MySQL-backed login on local/production browsers |
| SQL schema / foreign keys / status triggers | CODED | Import against real MySQL 8 and test migration |
| MySQL workspace and team permissions | CODED | Integration test cross-workspace access |
| MySQL media storage and signed URL | CODED | Verify private upload and external HTTPS fetch |
| Meta Page / Instagram OAuth adapters | CARRIED FORWARD | Actual credentials/permissions and live asset discovery need proof |
| Photo + Reel Meta publishing | CARRIED FORWARD | Live DTI test posts needed; not simulated |
| Scheduler with MySQL job and account locks | CODED | Concurrency, worker restart, duplicate prevention tests needed |
| Baseline TypeScript build and unit tests | CI | Verify newest commit status |
| Production unattended scheduling | NOT TESTED | Worker health, job recovery, browser-closed publishing |
| Security and deployment sign-off | PENDING | Secrets, TLS, backups, negative tests, monitoring |

All actual Meta publishing must remain disabled until the approved live tests are complete. An unverified published state is NEVER considered a success.
