# ProofLab — instructions for Claude

Loaded automatically in every session in this repository.
**Read [HANDOFF-2026-09-19.md](HANDOFF-2026-09-19.md) before any work.** It has the full picture: setup, architecture, runbooks, how the product works, current data and the open plan.
[SQUAD_SYSTEM.md](SQUAD_SYSTEM.md) explains squads, seasons and scoring. Read it before touching those.
`START_HERE.md`, `PROJECT_*.md` and `HANDOFF.md` are **older**:
- Their product descriptions still hold.
- Anything they say about Supabase, Vercel, MCP tools, table counts or deploy steps is out of date.

## What this is

A proof-of-skill platform for Indian engineering colleges (live: https://prooflab.co.in).
1. A college uploads a student CSV.
2. Each student gets one real task a day (a **Lot**), does it inside the app, and explains it out loud for 60 seconds.
3. Students learn on **Tracks** (17 tracks, 167 topics).
4. They compete in **squads** of about 11 inside their section.
5. Companies read the proof.

Dashboards:
- Student
- College (TPO)
- Admin
- Company (Startup and Recruiter merged; the database role is `startup`)

**Stack:**
- React + TypeScript + Vite.
- Everything runs on **Google Cloud**, project `prooflab-508214`, region `asia-south1`:
  - Cloud SQL `prooflab-db` (database `prooflab`)
  - PostgREST `prooflab-api`
  - Identity Platform + `prooflab-auth-bridge`
  - `prooflab-functions` (40 Deno functions, AI = DeepSeek)
  - `prooflab-files`
  - `prooflab-transcriber` + private `prooflab-transcription-worker` (Cloud Tasks queue `prooflab-transcription`)
  - `prooflab-accounts`
  - `prooflab-code-runner`
  - crawler job
  - Firebase Hosting
- **Supabase and Vercel are deleted.** The code still uses the `supabase-js` client, pointed at these services. There is no Supabase MCP, no `supabase db push`, no `supabase functions deploy`.

## Hard rules

- **A push to `main` deploys the live website** (`.github/workflows/deploy.yml`, about 5 minutes; a `test` job — unit tests, typecheck, Deno tests, build — must pass first). Work on a branch; merge to `main` only when tested and the owner has said yes. It deploys the website only, never functions or the database.
- **Never push to `origin`** (someone else's fork, `Yashwanth-pilli/prooflabai-mvp`). Push only to **`prooflaab`** (`manitejakanuri1/prooflaab`), branch `main`. Never offer to push to origin.
- **Ask before deleting anything**: data, logins, tables, columns, functions, files, branches. Show the exact list and back up first.
- **Nothing counts as working until a database row proves it.** `strict: false` in `tsconfig.app.json`, so the typechecker will not catch a wrong column. Prove it against the live database with a real signed-in session.
- **Plan first, then wait for the owner's "yes".** An interrupt means stop and wait. An old "yes" expires when the plan changes.
- **Secrets live only in Secret Manager.** Read them with `gcloud secrets versions access latest --secret=<name>`. Never write their values into files, commits or chat.
- Database changes:
  1. Write the SQL file in `migration/NN-*.sql`, with a `do $$` self-check, and end with `notify pgrst, 'reload schema';` when adding functions or columns.
  2. Save the same SQL in `supabase/migrations/`.
  3. Apply it with `gcloud sql import sql` (see the handoff). Direct psql is blocked.
- After `revoke all on function … from public, anon, authenticated`, **grant it back to `service_role` by name** if the server calls it.
- A new server function must be added to `SLUGS` in `functions-service/main.ts`. Deploy by building an image, then `gcloud run deploy`. Check that `/ready` shows loaded == expected.
- `void supabase.rpc(...)` never sends the request (the builder is lazy). Use `.then(() => {}, () => {})`.

## Product rules the owner set (do not "fix" these)

- Lots come from real pages in `source_content` (page-based). There is no `next_lot_level`. This is correct.
- **No upload proof.** Every task is done in the code editor or as a written answer, checked on the spot.
- **Students are never sent outside the app.** No external links on student screens.
  - Outside content is shown in-app only if its licence allows it (MIT, Apache, BSD, CC-BY, CC-BY-SA, CC0), with a plain-text credit.
  - W3Schools can't be used.
- Questions are shown **in simple words** (`task_explainers`), with the original wording one tap away. The task data itself is never changed.
- AI content is written **once and stored**. Say the cost before any paid AI job; the owner is cost-conscious.
- Everything should happen automatically (squads at import, auto-refresh, sync).

## How work is done here

- Check after every deploy:
  - `python scripts/healthcheck.py` (24 checks, about 25 s, expect all PASS).
  - The page check: `scripts/dev-tools/walk.mjs … crawl`.
- One commit per finished thing. The message says what was tested and what came back. Report honestly: if something is half-done, say which half.
- Test logins: the old t01-t18 / e2e logins were removed on 30 Sep 2026. Use the smoke student `vidyuthsetu+smoke01@gmail.com` (secret `prooflab-smoke-student-password`); see the Step 6 section below.
- After finished work, update the owner's Obsidian vault if it exists on this machine: note `Projects Brain/ProofLab.md` and a line in `log.md`.

## Style

The owner is not a developer.
- Plain, simple English and short sentences.
- Lead with the answer.
- Numbered steps, one action each.
- Diagrams and tables rather than paragraphs.
- Say what changed, what you tested, and what you deliberately did not touch.

## Books corpus and course plan (21 Sep 2026)
- Book text is NOT in the database. `scripts/dev-tools/collect_sections.py` (no AI) cuts open-licence repos into sections; the result is `gs://prooflab-private-508214/books/sections.jsonl.gz` (35,654 sections, 65 sources, 13.8 MB). Re-run: `python licence_scan.py <repos>` first, then `ONLY="repo1 repo2" python collect_sections.py` (adds to sections.json), then gzip + upload.
- Licence rule: a repo is copied only if its own LICENSE says permissive / attribution / share-alike (`licence_scan.py`). Non-commercial (You-Dont-Know-JS, javascript.info, hello-algo, fullstack-hy2020, anthropics/courses, NirDiamant/*) and GPL repos are NOT copied. Spring guides: code only (writing is CC BY-ND). Link lists (awesome-*, project-based-learning, free-programming-books) have no lessons and are skipped.
- Task screens show `tasks.code_sample` ("Given") and sample tests as Examples (`GivenMaterial.tsx`); coding panel is two columns.
- Roadmap Start opens the exact task: `/student/tasks/assigned?open=<task id>`.
- Course plan: `content/syllabus/python.json` (16 topics, 107 steps) is the first full syllabus. Loosening BM25 matching gave noisy cards, so topics are to be written FROM a book section instead.

## Course syllabi applied (21 Sep 2026)
- `content/syllabus/<course>.json` (23 courses, made by `scripts/dev-tools/build_syllabus.py` from book outlines, ~Rs 20) was applied by migration 28 (`scripts/dev-tools/apply_syllabus.py` writes it). Old topics were kept whole and renumbered into syllabus order; missing steps became 295 new topics (seed row + `level_syllabus.steps`), six new tracks (python, java, dsa, computer-science, system-design, deep-learning). Phases rebuilt as four equal parts; `student_tracks` unlocked/placed remapped so nothing that was open got locked. Migration 29 reloads the PostgREST schema.
- `ensureTopicSteps` (`_shared/levels.ts`, functions v31) writes a new topic FROM its `level_syllabus` steps (exact titles, exact count) in the short-line style: 5-9 one-sentence lines, real-life comparison first, code only in `code_example` with a final "# prints:" comment. A topic with more than ~10-12 steps can be cut off ("Topic content was cut off"): split it (iot "Modern C++" was split into 4 parts).
- All 465 topics / 3,578 steps are written. `scripts/dev-tools/warm_all.py [track...]` writes anything unwritten (safe to re-run; caches one admin sign-in because Firebase limits password checks). `match_sections.py --apply` fills Read more cards only where a step has none (1,392 of 3,113 steps have cards; the rest have no matching book text, which is fine).
- New steps have no "Go deeper" block yet (only the original 1,325 do).

## Course links and resume aliases (21 Sep 2026)
- `topic_links(level_id, course_slug)` marks the short Python / Java primer topics inside role tracks (8 of them: data-science 1, machine-learning 1, robotics 1, cloud 4, devops 3, iot 10, cybersecurity 11, mobile 13). `level-open` on such a topic returns `course_link` (offer: open the full course / skip = status `revise` / short version). `syncCourseLinks()` (`_shared/levels.ts`, run in level-open and level-quiz-submit) marks the primer `placed` once the whole course is finished, so nothing is taught twice; it never locks anything. UI: `LevelDetail` card + `LevelMap` "Back to <track>" banner.
- `skill_aliases` maps resume wording to level skills (dsa, js, html, k8s, ...) inside `suggest_tracks`. `fix_new_topic_skills.py` gave new topics in role tracks a matchable skill. Migration 30.

## Skill courses (21 Sep 2026, migration 32)
- 18 standalone courses for skills that role tracks teach only as primers: sql, docker, cpp, linux, networking, html-css, javascript, react, pandas, numpy, aws, terraform, linear-algebra, probability, rest-apis, bash, kubernetes, git (defined in `build_syllabus.py` SKILL_COURSES). Built like the first six: `build_syllabus.py <slugs>` -> `apply_syllabus.py <slugs>` (incremental; writes migration/32-skill-courses.sql, splits topics over 10 steps) -> apply -> `warm_all.py <slugs>` -> `match_sections.py --apply`.
- Each skill course links the FIRST topic with that skill in every role track (`topic_links`), so the same course-card flow applies (open / skip / short version, credited once the course is finished).
- Now 41 tracks, 817 topics, 6,087 rows. Docker, Linux, AWS, Terraform, Bash, Kubernetes, SQL have almost no book text in the corpus (licences / link lists): their syllabus and lessons come from the model's own knowledge, with few Read more cards.

## College / admin wiring (21 Sep 2026, migration 33)
- `tpo_student_learning(_student_id)` (same college/admin/self check as `tpo_student_profile`) returns each path a student joined with topics done/total. The college student profile shows it as "Learning paths". The admin Students screen does not show it yet; the RPC already works for admin.
- Neither dashboard had any track/level code before; nothing there reads the 41 tracks, so nothing broke. No college-wide course report exists yet.

## Logging standard (21 Sep 2026, functions v34, migration 36)
- Every browser call to a function carries `x-request-id` (one per call) and `x-session-id` (one per tab) - `src/integrations/google/client.ts` `tracedFetch`. CORS allows both (`_shared/cors.ts`).
- `_shared/log.ts`: the router (`functions-service/main.ts`) runs each request inside `withRequestContext`; every `console.*` line becomes one JSON line with `severity`, `message`, `request_id`, `session_id`, `function`, hashed `user`, and Cloud Run `trace`. The response carries `x-request-id`. A `request.end` line records status and duration (errors and calls over 2 s always; set `LOG_SAMPLE=0.1` on the service to sample normal ones at scale).
- Never log resume text, answers, voice, passwords, keys. `scrub()` removes emails, tokens and keys and cuts long strings, but do not rely on it: do not print such things.
- `llm_usage.request_id` links each AI call to the request that caused it.
- Find one action: Logs Explorer, `jsonPayload.request_id="<id>"`. Errors are grouped in Error Reporting (API enabled). Database Query Insights is on.
- Not done yet: alerts and uptime checks (Phase 5), the `app_events` step trail and admin Student Trace page (Phases 3-4).

## Student step trail (21 Sep 2026, functions v35, migration 37)
- Table `app_events` (90 days; RLS on, no policy; written only by the `client-log` function, read only through `admin_trace_search/student/funnels/errors/slow`, which refuse non-admins). Pruned daily by Cloud Scheduler `prooflab-prune-events` (03:10 IST -> `scheduled-job?job=prune-events` -> `prune_app_events()`).
- Browser: `src/lib/tracker.ts` (queue, batches of up to 50 every 5 s, sent to `client-log`), `TrackerBridge` (on only for logged-in students under `/student`), call timings from `client.ts` (`setCallObserver`: all function calls; table calls only when failed or over 1.5 s). Records pages, button labels (50 chars), calls, errors. Never typed text, answers, resume text or voice.
- Admin: Platform -> Student Trace (timeline per student, funnels, top errors, slowest calls). Funnel steps are fixed in `admin_trace_funnels` (function name -> step label).
- `client-log` is quiet in server logs (only failures and slow calls). It records students only; other roles get a 204.
- At 1 lakh students move the trail to BigQuery / sample normal events: about 10 million rows a day is too much for the main database.

## Alerts and uptime checks (22 Sep 2026)
- `python scripts/setup_monitoring.py [email]` creates (idempotent, by display name) one email channel, 4 uptime checks (site, functions `/ready` with `"ok":true`, API, voice `/ready`) and 19 alert policies named `[P1] ...` (urgent) and `[P2] ...` (look today): uptime down x4, Cloud Run 5xx, slow p95, voice/code busy (429/503), voice/code 5xx, login 4xx spike, container CPU/memory, database down / CPU / disk / memory / connections, scheduler job failed, crawler failed, AI providers failing.
- Alerts go to the email channel "ProofLab alerts (<email>)" - by default the gcloud account (`deploy.openfloor@gmail.com`). Add more people with `python scripts/setup_monitoring.py other@x.com` (creates another channel) and attach it to the policies in the console.
- A temporary policy `[TEST] alert pipeline check (delete me)` fires on any ERROR log named `alert-test`: `gcloud logging write alert-test "test" --severity=ERROR`. Delete it once delivery is confirmed.
- Not yet: billing budget alerts (needs billing admin), "daily tasks not created by 06:00" and "Sunday scoring did not run" (need a small database check), deploy-failed alert, queue backlog alerts (no queues yet), database connection limit is a guess (40) until the real limit is known.

## Alerts and uptime checks, extended (22 Sep 2026, functions v37)
- All 7 Cloud Run services now have an uptime check: site, functions `/ready`, API, transcriber `/ready`, accounts `/ready`, code-runner `/ready`. auth-bridge and files run an older image with no `/ready` route; their check hits an unknown path and accepts the 404 body `"error":"not found"` as proof the container is answering (a dead container fails differently). Redeploying those two to add `/ready` is a future cleanup, not done here.
- `scheduled-job` now runs a `sanityCheck()` after `daily-lots` and `weekly-seasons`: logs a distinct `JOB SANITY: ...` line (not a thrown error, so the job still reports success to Scheduler) when the job ran but did nothing useful - 0 tasks exist for today, or 0 seasons were scored/closed/advanced. Two matching alert policies watch those exact log lines. Verified live: a first version compared `student_weekly_scores.computed_at` to a time window and false-alarmed on a legitimate no-op rerun; fixed to trust `run_all_seasons`'s own returned counts instead.
- 25 alert policies total, 8 uptime checks. Billing Budgets API enabled (no budget created yet - needs a rupee figure from the owner).
- Still not done: billing budget amount, GitHub deploy-failed alert, queue backlog alerts (no queues yet), tuning thresholds after real traffic, confirming the alert email actually lands in an inbox someone reads.

## Everything monitored, fully wired (22 Sep 2026)
- auth-bridge redeployed from current source (was on a stale image `v-no-vercel`; no code change, same env vars, tests pass). files-service left on its current image - not needed, see below.
- `/healthz` is a path Google's own edge (GFE) intercepts and 404s on a bare `*.run.app` URL before the request reaches the container - true even for files-service's OLD image that has no such route, so it is a platform quirk, not our bug. The login-bridge and files-service uptime checks now hit `/` instead (our app's own 404 JSON, proven live), 4xx accepted. Do not put a real health route at `/healthz` on a public Cloud Run URL; use `/ready` or anything else.
- `setup_monitoring.py` now also PATCHes an existing uptime check's path if the script's list changes it (previously only created missing ones).
- Billing budget: **₹3,000/month**, alerts at 50/80/100%, wired to the same email channel. Change the amount with `gcloud billing budgets update 348d7fa6-0a9c-476e-826b-6a88c632f1ec --billing-account=01D93F-F00D33-69E256 --budget-amount=<N>INR`.
- GitHub Actions deploy-failure alert: deliberately NOT added via Cloud Logging - it would need granting `github-deploy@...` (the deploy service account) a logging-write role, breaking the account's documented scope ("may publish to Hosting and do nothing else"). GitHub's own default email-on-failed-run notification covers this instead; confirm the repo owner has that GitHub notification enabled.

## Bug finder (22 Sep 2026) - BUILT, NOT ACTIVATED
- `bug-finder/run.mjs`: a Playwright robot that signs in as dedicated test accounts (student, college, admin) and uses the LIVE app like a real person - not a load test, one journey at a time. Steps: student sign-in, dashboard, roadmap/lesson, daily task card; college sign-in + students list; admin sign-in + content library. Known gap: does not test voice recording yet (needs a fake microphone).
- Runs as Cloud Run **job** `prooflab-bug-finder` (image `prooflab-bug-finder:v2`), same shape as the crawler job. Results: printed as structured `BUG FINDER: ...` log lines (Cloud Logging), and saved to table `bug_finder_runs` (read via `admin_bug_finder_runs`/`admin_bug_finder_steps`, admin only) - admin tab Platform -> Bug Finder. It mints its own service-role JWT from `PGRST_JWT_SECRET` at runtime (same scheme as `pl.py token('svc')`) rather than a static key - PostgREST here has no separate service-role API key. The compute service account (`135298577404-compute@...`) was granted `secretAccessor` on the three test-login secrets it needs.
- Tested live twice: first run correctly caught 8/9 (test account `t15` had never done intake, so had no daily task - a real, correct result, not a script bug). Switched the student account to `t07` (already through intake) and reran: 9/9. Both runs are saved in `bug_finder_runs`, proving pass AND fail are both recorded.
- **Not scheduled.** No Cloud Scheduler trigger exists for it yet - the owner asked to build it fully but hold off turning it on until their manager approves, since it makes real (light) traffic against the live site on its own. To activate: `gcloud scheduler jobs create http prooflab-bugfinder-run --location=asia-south1 --schedule="<cron>" --uri=".../jobs/run" ...` (Cloud Run Jobs API, not the `scheduled-job` function) - ask before adding, then also add the `[P1] Bug finder failed twice in a row` alert.
- Run it by hand any time: `gcloud run jobs execute prooflab-bug-finder --region=asia-south1 --project=prooflab-508214 --wait`. Cost per run: ~1-2 minutes of Cloud Run job time, no AI cost (no AI calls in the script itself) - only the real cost is the handful of real page loads it causes, same as one student using the app once.

## Bug finder ACTIVATED (22 Sep 2026)
- Cloud Scheduler `prooflab-bugfinder-run` triggers Cloud Run Job `prooflab-bug-finder` every 6 hours (00:00, 06:00, 12:00, 18:00 IST), same trigger pattern as `prooflab-crawler-weekly` (compute service account, Cloud Run Jobs v2 `:run` endpoint).
- Verified live: fired the scheduler by hand, watched a real execution complete, and confirmed its 9/9 result was saved with `failed_steps: []` (the earlier null-crash fix holds).
- Alert `[P1] Bug finder found a broken step` fires on ANY failed step (log message `BUG FINDER RUN FAILED`), not specifically "twice in a row" - a simpler, already-tested log-match rule. The false-positive risk this could have had (a demo account with no intake looking like a bug) was removed by fixing the test account, not by requiring repeats. 26 alert policies total now.

## Bug finder: schedule now 3x/day; deep (AI) journey built but NOT scheduled (22 Sep 2026)
- Schedule changed 4x -> 3x/day: `0 6,14,22 * * *` IST (`prooflab-bugfinder-run`).
- Added a `DEEP=1` path (`bug-finder/run.mjs`) that also exercises the real AI journey: synthetic (fake, in-memory) resume upload via pdf-lib, confirm, timed test, coding round "Run sample". Uses a SEPARATE dedicated account (`BUGFINDER_DEEP_STUDENT_EMAIL`, default t16) so it can wipe and reuse that account's `resume_claims` (cascades to assessments/scorecards) before every run without ever touching the light-check account.
- **Found and fixed 3 real bugs while proving this out:**
  1. `/student/resume-onboarding` redirects away once the account has any `resume_scorecards` row - the deep check now deletes its own account's `resume_claims` first (`resetDeepAccount()`, service-role JWT minted at runtime, same scheme as `pl.py token('svc')`).
  2. The "did the upload finish" wait condition was looser than the "did it actually work" check, so on a slow page it could resolve on stale pre-upload text. Fixed to wait for one exact, unambiguous heading ("Resume feedback") instead of a loose regex.
  3. **Accidentally broke the live t07 test account** by briefly pointing the deep check's account at it mid-debugging, which deleted its resume history and reset `student_tracks`... no - reset `intake_completed_at`'s truthiness (it depended on a now-deleted scorecard as a fallback signal), sending it back to `/student/start`. Repaired by setting `student_intake.intake_completed_at` directly. **Lesson: never point `BUGFINDER_DEEP_STUDENT_EMAIL` at an account any other check or a real test login relies on.**
- **DEEP is NOT on the schedule.** Confirmed the job's saved config has no `DEEP` env var (an `execute --update-env-vars=DEEP=1` only affects that one manual run, does not persist) - checked directly via `gcloud run jobs describe`. Still flaky as of the last manual run (a genuine 90s timeout on the resume-analysis wait, cause not yet isolated - possibly single-vCPU contention running 4 browser contexts in one job, worth splitting into its own Cloud Run job before it goes on a schedule). Do not schedule it until it passes several manual `--update-env-vars=DEEP=1` runs in a row.
- Cost if/when scheduled: ~Rs 1.5 per deep run (real DeepSeek calls) - at 3x/day that would be ~Rs 135/month, on top of the light check's near-zero cost.

## Live state after the Step 6 release (verified live 30 Sep 2026 - supersedes older notes above)
- **Frontend:** `prooflab.co.in` = GitHub `main` (`.env.production` has `VITE_ASYNC_TRANSCRIPTION=true`; deploy.yml verifies the real entry script from `index.html`). Entry bundle `assets/index-CWe_5Kb3.js` (Hosting version `79a3164cfe001a3b`, 1 Oct 2026). A push to `main` rebuilds and republishes; it reproduces live.
- **Three different targets - do not call them all "staging":**
  1. Production site `prooflab.co.in` -> production services (`prooflab-*`, `prooflab-db`).
  2. (Retired 1 Oct 2026) Firebase preview channel `step6-async-canary` was deleted and its origin removed from production `ALLOWED_ORIGINS`.
  3. True staging -> `prooflab-staging-*` services, `prooflab-staging-db`, queue `prooflab-staging-transcription`, staging worker; reached from a local `vite --mode staging` build.
- **Voice (production):** browser -> files (private bucket) -> functions `transcription-enqueue` -> Cloud Tasks `prooflab-transcription` -> private `prooflab-transcription-worker` (SA `prooflab-transc-wk`, invoker only `prooflab-tasks-invoker`) -> `prooflab-transcriber` (Whisper) -> DB transcript -> `voice-score` (DeepSeek) -> Build-Log. The transcriber is IN USE (called by the worker).
- **Recovery:** Cloud Scheduler `prooflab-transcription-reap` (every minute, `x-webhook-secret`, same secret as the other production jobs) -> functions `transcription-reap`. Stale/never-enqueued jobs re-queued (max 8 recoveries), unscored server transcripts scored; failures answer 500 -> "[P1] A scheduled job failed".
- **Functions:** 40 (`/ready` 40/40), revision 00052-g84 (1 Oct 2026). Written tasks: optional `task_rubric_config.scratch_language` (migration 48), set automatically by `lot-writer` for written technical Lots or by admin (Edit Task). `submit-sandbox-task` returns `passed` from `record_task_submission.status`.
- **Bug finder:** both normal (`0 6,10,14,18,22 * * *`) and deep (`0 4 * * *`, DEEP=1) runs use `vidyuthsetu+smoke01@gmail.com` (secret `prooflab-smoke-student-password`). The t01-t18 / e2e / lessontest test logins were removed on 30 Sep 2026; source-code defaults in `bug-finder/run.mjs`, `scripts/healthcheck.py` and `scripts/dev-tools/pl.py` now point at smoke01 (1 Oct 2026).
- **Dedicated smoke student:** `vidyuthsetu+smoke01@gmail.com`, Demo College, section `TEST-SMOKE` (own section, never squadded with real students).

## Release closure (1 Oct 2026)
- Current documents: `docs/PRODUCTION-ARCHITECTURE.md`, `docs/AUTHORIZATION-MATRIX.md`, `docs/DISASTER-RECOVERY-RUNBOOK.md`, `docs/FINAL-RELEASE-GAPS.md`, `docs/RELEASE-CERTIFICATE-2026-10-01.md`.
- Steps only the owner can run (blocked for Claude): `docs/closure/OWNER-COMMANDS.md`.
- Migration 49 (college reports answer approved college accounts only, G28) applied to staging and production on 1 Oct 2026; rollback `migration/49-rollback-college-reports.sql`. Closure status: G01, G02, G10, G28 PASS; G06 and G05 left (owner commands 7, 8).
- Check scripts: `scripts/dev-tools/attack_surface_check.py` (anonymous, 66 checks), `authz_matrix_check.py` (per role), `staging_load_test.py`, `staging_reaper_fixture.py` (staging only).
