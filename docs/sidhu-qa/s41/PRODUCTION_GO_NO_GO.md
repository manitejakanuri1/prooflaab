# Production GO / NO-GO (13 Oct 2026)

**NO-GO.**

| Gate | Required | Today |
|---|---|---|
| Release SHA | one integrated SHA, CI green | QA branch head (this commit) includes TEJA `441d378` + S40/S41; TEJA's newer `e9b1d52` was not fetched in this session (fetch declined), so it is **not tested here** |
| Source = staging deployment | site and 4 services built from that SHA | staging serves `59235dd` (8 Oct), functions `00075-git`, web-bff `00004-9nn`, accounts `00015-rpk`, files `00012-gf4`: **FAIL (old build)** |
| Migrations on staging | ... 109, 110, 111, 112 | 110 applied 13 Oct 02:30 IST (3 accounts on the owner's reconcile hold); **111, 112 not applied** |
| Database API reachable directly | publicly invokable (staging and production, `allUsers`) | signed-out direct probe of staging: 28 tables + 29 read-only functions, **57 PASS, 0 FAIL** (refused or no data). 100 SECURITY DEFINER functions are executable by anon on staging; the read-only ones are probed, the writing ones are not called |
| Signed-in E2E, five roles | all launch-critical rows PASS | 1,287 rows **BLOCKED** (no `staging-e2e`) |
| Destructive identity tests | isolated tenant, disposable pool | **BLOCKED** |
| Scheduled workflows on staging | jobs exist | only `transcription-reap`: **BLOCKED** |
| Open P0/P1 | none | three P1s fixed in source (unmapped sync, live-only functions, live-only triggers); not yet deployed |
| Privacy decisions | S38-01 versions/retention, S36-05 | **OPEN (owner)** |
| Rollback / restore drill | done on staging | **NOT_TESTED** |

## Rollout steps once the gates pass

1. TEJA: merge this QA branch with `e9b1d52` (no force-push), CI green on the merge SHA.
2. TEJA: deploy that SHA to staging; apply 110 then 111; isolated Identity tenant; add the staging scheduler jobs.
3. Owner: `staging-e2e` secrets and QA identity (see E2E_RESULTS_BY_ROLE.md).
4. Sidhu: signed-in pass, write pass, deletion pass; fix, rerun to zero FAIL.
5. Owner: privacy decisions; production backup; approve.
6. TEJA: production 110, 111, then services one at a time, health check 24/24 after each; rollback = previous
   revisions (`gcloud run services update-traffic ... --to-revisions=<previous>=100`) and `110-rollback`
   (111 needs none: it only writes down what production already has).
