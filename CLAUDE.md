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
  - `prooflab-functions` (36 Deno functions, AI = DeepSeek)
  - `prooflab-files`
  - `prooflab-transcriber`
  - `prooflab-accounts`
  - `prooflab-code-runner`
  - crawler job
  - Firebase Hosting
- **Supabase and Vercel are deleted.** The code still uses the `supabase-js` client, pointed at these services. There is no Supabase MCP, no `supabase db push`, no `supabase functions deploy`.

## Hard rules

- **A push to `main` deploys the live website** (`.github/workflows/deploy.yml`, about 4 minutes, no tests). Work on a branch; merge to `main` only when tested and the owner has said yes. It deploys the website only, never functions or the database.
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
- Test logins (kept): `vidyuthsetu+t01 … +t11@gmail.com` (Demo College, section `TEST-A`), password in Secret Manager `prooflab-testusers-password`. Also `vidyuthsetu+e2e` (used by the health check). Do not remove them without asking.
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
