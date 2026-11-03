# CherryLink acceptance ledger — 2026-11-03

| Milestone | Deliverable | Status | Evidence / blocker |
|---|---|---|---|
| M0 | Meta app ownership/configuration confirmed | BLOCKED | Developer dashboard not connected in this environment |
| M0 | FB authorized test text/photo/Reel | NOT RUN | No Meta test tokens/assets; live publishing disabled |
| M0 | IG authorized image/Reel | NOT RUN | No Meta test tokens/assets; Unified Login configuration unknown |
| M1 | Separate source architecture | CODED | Initial source prepared for CherryLink repository branch |
| M1 | PostgreSQL schema/RLS | CODED / NOT DEPLOYED | 0001 and 0002 migrations need new Supabase project |
| M1 | Supabase Auth and workspace authorization | CODED / NOT INTEGRATION-TESTED | Test project required |
| M2 | Responsive navigation/composer/calendar/media/admin | CODED / NOT BROWSER-TESTED | npm install and browser test required |
| M3 | Facebook + Instagram publishing adapters | CODED / NOT LIVE-TESTED | Official Meta calls not yet tested with owned assets |
| M4 | DB jobs, row locks, advisory account lock, attempts | CODED / NOT STRESS-TESTED | Database concurrency tests required |
| M4 | Ambiguous response quarantine | CODED / RECONCILIATION PARTIAL | Auto-safe recovery limited by provider reconciliation data |
| M5 | Automated tests | WRITTEN / NOT EXECUTED | Network package install unavailable in work environment |
| M5 | Mobile, authorization, restart and duplicate tests | NOT RUN | Requires environment/dependencies and API mocking |
| M6 | Persistent worker deployment | NOT RUN | Worker host, secrets, domain and monitoring required |
| M6 | Production-ready status | NOT APPROVED | Must first pass all required live tests |

This is a meaningful first development artifact, **not a completed or production-validated V1.0**.
