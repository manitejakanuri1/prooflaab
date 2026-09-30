# G02 — restore drill: verification (1 Oct 2026)

**Result: G02 PASS.** A point-in-time copy of production was restored into a new temporary
instance, checked with the same read-only audit as G01, and deleted. Production was not touched.

| Item | Evidence |
|---|---|
| Restore method | `gcloud sql instances clone prooflab-db prooflab-restore-drill --point-in-time=<now-15 min>` (owner command 2) |
| Restore time (RTO for a clone) | **568 s (9 min 28 s)**, measured by the owner |
| Check ran against the copy, not production | Cloud audit log: `cloudsql.instances.connect` on `prooflab-restore-drill` at 2026-09-30 23:07:38 UTC; check job logs 23:08:44 UTC |
| Output | `docs/closure/restore-drill-output.txt`: 84 result lines, `END`, `__EXIT=0`, read-only = on |
| Compared with production (`prod-audit-output.txt`) | **Identical in every line except `S0conn`** (open connections 10 vs 15: the live services hold connections to production only) |
| Schema and Migration 48 | Same column, check constraint, view fingerprint, values (34 NULL + 1 python), fallback NULL |
| Corrected Migration 45 | Same fingerprints `934a30f1…`, `a1abecfb…`, `f17ce0e1…` (= 6DD script) |
| Submissions / voice invariants | Same: 8 submissions, 2 scored server recordings, 0 stale / duplicate / unscored |
| Grants, RLS, triggers | Same |
| Referential integrity | Same: all 9 orphan checks 0, 0 unvalidated FKs |
| Clean-up | `cloudsql.instances.delete` on the copy (23:11:15 UTC); `gcloud sql instances list` shows only `prooflab-db` and `prooflab-staging-db`; check job gone |

Recovery targets now proven: a full database copy at any point in the last 7 days can be restored
in about 10 minutes. Switching production to a restored copy (updating `prooflab-db-uri` and
redeploying api/functions/accounts) is still a decision for the owner at the time, per
`docs/DISASTER-RECOVERY-RUNBOOK.md` section 6.
