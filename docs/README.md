# docs/ - which document to trust

Checked 7 Oct 2026 against `main` `d814d5d`. If a document disagrees with the code or the running
system, the code and `scripts/infra_snapshot.py` win.

## CURRENT - describe the system as it runs now

| Document | What it is |
|---|---|
| [PRODUCTION-ARCHITECTURE.md](PRODUCTION-ARCHITECTURE.md) | The live system; section 0 has the 7 Oct state |
| [../DEPLOYING.md](../DEPLOYING.md) | How each part is deployed (website, services, database) |
| [AUTHORIZATION-MATRIX.md](AUTHORIZATION-MATRIX.md) | Who may do what |
| [FINAL-NAVIGATION-MAP.md](FINAL-NAVIGATION-MAP.md) | Screens and menus per role |
| [STAGING-TEST-FIXTURES.md](STAGING-TEST-FIXTURES.md) | Protected staging accounts used by the checks |
| [RELEASE-MANIFEST.md](RELEASE-MANIFEST.md) | Released commit, image digests, migration checksums |
| [STABILIZATION-EXECUTION-REGISTER.md](STABILIZATION-EXECUTION-REGISTER.md) | Status of every stabilization item |
| [DEAD-CODE-AND-DATABASE-CLEANUP-2026-10-07.md](DEAD-CODE-AND-DATABASE-CLEANUP-2026-10-07.md) | What was removed, what is kept and why; database cleanup runbook |
| [COST-CONTROL-PLAN.md](COST-CONTROL-PLAN.md), [CLOUD-CAPACITY-PLAN.md](CLOUD-CAPACITY-PLAN.md) | Spend and capacity rules |

## ROLLBACK / RUNBOOK - keep; used when something goes wrong

[PRODUCTION-ROLLOUT-CHECKLIST.md](PRODUCTION-ROLLOUT-CHECKLIST.md),
[PRODUCTION-ROLLBACK-CHECKLIST.md](PRODUCTION-ROLLBACK-CHECKLIST.md),
[DISASTER-RECOVERY-RUNBOOK.md](DISASTER-RECOVERY-RUNBOOK.md),
[step6-production-rollout-runbook.md](step6-production-rollout-runbook.md), and `closure/`.

## HISTORY - snapshots; true on the date in their name, not necessarily now

- Every file with a date in its name (`*-2026-10-0N.md`, `RELEASE-CERTIFICATE-2026-10-01.md`).
- Every `STEP6*` file and the `*.sql` / `*-output.txt` evidence beside them.
- `PROOFLABAI-*`, `CURRENT-PRODUCTION-ARCHITECTURE-AUDIT.md`, `EVALUATION-ENGINE-AUDIT.md`,
  `FINAL-RELEASE-GAPS.md`, `ZERO-LEGACY-AUDIT.md`, `PENDING-APPROVAL-PROPOSALS.md`,
  `CONCURRENCY-2000-REPORT.md`, `prooflabai-founder-blueprint.md`, `prooflabai-product-document.md`,
  `greptile-review-2026-08-23.pdf`, `architecture-refs/`.

They are kept on purpose: they are the evidence behind decisions, migrations and the release.
Do not follow deploy or operating steps from a HISTORY document - use the CURRENT ones above.
