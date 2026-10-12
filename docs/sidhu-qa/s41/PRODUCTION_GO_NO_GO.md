# Production GO / NO-GO (13 Oct 2026)

**NO-GO.**

| Gate | Required | Today |
|---|---|---|
| Release SHA | one integrated SHA, CI green | QA branch head (this commit) includes TEJA `441d378` + S40/S41; TEJA's newer `e9b1d52` was not fetched in this session (fetch declined), so it is **not tested here** |
| Source = staging deployment | site and services built from that SHA | **13 Oct ~03:30 IST: TEJA deployed release candidate `3847f3e`** (release/teja-sidhu-s41-staging-rc-2026-10-13). Site **VERIFIED** in CI (c8c03eb provenance job: 3847f3e builds to `index-Ju1L-FZy.js` = live). Services at 100%: functions `00081-wib`, web-bff `00013-duc`, accounts `00020-kej`, files `00015-nip`, auth-bridge `00018-mob`, api `00006-6x4` (images not yet tied to a commit by me: needs the QA identity or TEJA's digest table) |
| Signed-out checks on the RC | all pass | gateway 68/68, direct database API 57/57, screens 100/100 (CI, 13 Oct) |
| Migrations on staging | ... 109, 110, 111, 112, 113 | 110 (02:30), 111 (03:45), 112 (03:47) applied 13 Oct; ledger checksums equal this branch's files byte for byte; **113 not applied** (written after the RC) |
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
