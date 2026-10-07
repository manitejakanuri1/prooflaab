# Dead code and database cleanup - final (7 Oct 2026)

Branch `work/dead-code-cleanup-final`, cut from `prooflaab/main` = `d814d5d` (production baseline:
migration 93 applied, webhook secret v2, schedules restored). Nothing deployed, nothing pushed, no
production change. Staging used only for read-only queries and transactions that ended in `rollback`.

Rule: prove dead from several angles, then delete. Cannot prove it: keep and say why. Git history is
the archive.

## 1. Before / after (measured the same way on `d814d5d` and on this branch)

| Measure | Before (`d814d5d`) | After | Change |
|---|---|---|---|
| Tracked files | 1,045 | 1,026 (+ this report) | -19 net (24 deleted, 5 added) |
| `src/` files | 258 | 244 | -14 |
| `src/` lines | 54,208 | 51,526 | -2,682 |
| All code lines (`.ts/.tsx/.mjs/.js/.py/.sql/.sh`) | 133,820 | 130,817 | -3,003 |
| JS + CSS bundle | 3,529,161 B | 3,521,796 B | -7,365 B (-0.21 %) |
| gzip | 1,013,377 B | 1,012,261 B | -1,116 B |
| npm packages (dep + dev) | 42 + 17 = 59 | 38 + 16 = 54 | -5 |
| npm audit findings | 9 (3 moderate, 6 high) | 7 (2 moderate, 5 high) | -2 |
| Frontend routes (`<Route>` in App.tsx) | 19 | 19 | 0 |
| Active function slugs (`SLUGS`) | 32 | 32 | 0 |
| Website unit tests | 111 | 97 | -14 (exactly the tests of deleted `voiceStatus.ts`) |
| Deno tests (`_shared` + reap) | 173 | 173 | 0 |
| TODO / FIXME / HACK / XXX | 3 | 2 | the 2 left are a regex constant named `TODO` |
| `tsc --noUnusedLocals` findings | 105 | 1 | the 1 left is a kept, reported bug |
| `git diff --shortstat d814d5d HEAD` | - | 96 files, +707 / -4,642 lines | added = migration 94, this report, docs, `staging_token.mjs` |

No speed claim is made: the bundle was already tree-shaken, so the size gain is small.

## 2. Commits (in order)

| Commit | Category | What |
|---|---|---|
| `a4418e2` | A | 11 unreachable frontend files (cherry-pick, revalidated on `d814d5d`) |
| `d407b0e` | B | 77 unused imports in 35 files (compiler-proven) |
| `9373976` | C | 5 unused npm packages + stale `bun.lock` |
| `67a6d04` | B | 7 unused exports |
| `222a12c` | A | 2 more files orphaned by the import removal |
| `a50a8fd` | B | 27 of 28 unused locals, each reviewed by hand |
| `fdcdaa0` | D | 6 broken staging browser scripts repaired, 1 deleted; shared `staging_token.mjs` |
| `3eaf0a4` | D | `g1_access_test.py` repaired |
| `7ca00fd` | E | one profile-photo modal instead of two |
| `af17a86` | F | 38 debug `console.log` removed from browser code |
| `e801c5e` | F | deploy docs rewritten for Google Cloud (cherry-pick of `d65be1d`) |
| `0aea1c4` | F | architecture doc at closure state; `docs/README.md` index; history banner |
| `67089d5` | F | `interview-scraper/` deleted |
| `9a4a65e` | F | `.gitignore` for check-tool outputs |
| `35905b6` | DB | migration 94 prepared - **NOT APPLIED** |
| `5e6209a` | E | whitespace in the consolidated modal |
| `f6f9178` | C | `source-map-js` patch (cherry-pick of `e0fb9e9`; dist byte-identical) |
| this commit | G | this report |

## 3. Every candidate

Classes: SAFE_DELETE, KEEP_CURRENT, KEEP_ROLLBACK, KEEP_HISTORY, REPAIR, DEFER_DB_DELETE, UNKNOWN (= keep).

### 3.1 Files deleted (24)

| File | Evidence | Commit |
|---|---|---|
| `src/pages/Pricing.tsx` | not in import graph; `/pricing` already `<Navigate to="/">` (route kept) | `a4418e2` |
| `IntegrityDeclarationModal.tsx`, `VerificationBadges.tsx`, `VerificationSummaryModal.tsx` | proof-era; not in graph; docs-only mentions | `a4418e2` |
| `admin/StartupOversight.tsx` | not in graph; no tab mounts it | `a4418e2` |
| `ui/form.tsx`, `ui/slider.tsx`, `ui/use-toast.ts` | not in graph (`use-toast` was a re-export shim) | `a4418e2` |
| `src/App.css` | never imported (Vite template) | `a4418e2` |
| `src/lib/voiceStatus.ts` + `.test.ts` | consumer removed in `292358b`; 14 tests of retired code | `a4418e2` |
| `bun.lock` | nothing uses Bun; all builds `npm ci` | `9373976` |
| `auth/EmailVerificationScreen.tsx` | only importer never rendered it | `222a12c` |
| `student/StudentNotificationsPage.tsx` | only importer never rendered it; `notifications` view redirects to `profile` | `222a12c` |
| `ProfilePhotoModalUniversal.tsx` (+ old `ProfilePhotoModal.tsx` content) | merged: identical student path; one file `ProfilePhotoModal.tsx` remains | `7ca00fd` |
| `scripts/dev-tools/voice_buildlog_browser.mjs` | tests the Build-Log recordings card removed in `292358b` | `fdcdaa0` |
| `interview-scraper/` (8 files) | never deployed (live infra), no caller/CI/DB; 3 audits "unused"; crawler does this job | `67089d5` |

### 3.2 Packages removed (5)

`react-hook-form`, `@hookform/resolvers` (only `ui/form.tsx`), `@radix-ui/react-slider` (only `ui/slider.tsx`),
`react-icons` (never imported), `@tailwindcss/typography` (not in Tailwind plugins). Remaining zero-import
packages are tooling: `@types/*`, `typescript`, `eslint`, `postcss`, `autoprefixer` (via `postcss.config.js`).

### 3.3 Imports / exports / locals

- 77 unused imports (TypeScript "remove unused" action; compiler-proven).
- 7 unused exports: `currentIdToken`, `__resetForTests` (identity.ts), `TaskTab`, server `SECTION_LABELS`,
  `TARGET_ROLES`, `TestCase`, `NON_CODING_INTERESTS`. Kept: `__setSessionForTests` (voice harness uses it).
- 28 unused locals reviewed one by one (`a50a8fd`):

| Local | Verdict | Why |
|---|---|---|
| ResumeCheckFlow `handleAcknowledge`, `acknowledging` | A dead | button removed in `3bf4661`; students cannot write `resume_claims` since migration 50 |
| Portfolio follow-modal state (4) | A dead | follow feature retired `180beff` |
| TpoImportStudents `splitLine`; `failed` | A dead / D | replaced by CSV/Excel reader `ebf7e68`; count never shown |
| ManageAnnouncements `handleStatusChange`, `clearFilters` (+ filter machinery) | A dead | filter could never leave "all": impossible branch; list renders `announcements` directly |
| TpoSquads `students` (+ `tpo_students` call, `StudentRow`) | A dead | fetched every load, never used; RPC still used by Students/Insights |
| StudentRoadmapPage `statusMeta` (+3 icons), `loading`, `hasScorecard` | A dead | write-only / never read |
| AuthCallback `loading`; AssignTasksScreen `uploading`; StartupWizard `DOMAINS` | A dead | write-only / never offered |
| `periodKey`, `packId`, CollegeDashboard `loading`, `uploadData` (x2), `navigate`, 4 hook names | D accidental | unused bindings |
| `src/pages/Auth.tsx` `setUserEmail` | **E - KEPT** | latent BUG: verification prompt always gets an empty email. Report, fix separately - not dead code |

### 3.4 Scripts (section 6 of the request)

| Script | Meant to prove | Other coverage | Account | Old HS256 | Decision |
|---|---|---|---|---|---|
| scratchpad_browser | written-task scratchpad in a browser | unit `scratchpad.test.ts`, `scratch_test.ts` | t07 row exists on staging | yes | REPAIR |
| voice_modal_browser | VoiceExplainModal real-browser checks | unit voice tests (logic only) | t07 | yes | REPAIR |
| voice_modal_blob_browser | blob URL ownership | `blobUrlOwner.test.ts` (logic only) | t07 | yes | REPAIR |
| voice_modal_lifecycle_browser | modal lifecycle/concurrency, writes faked | `voiceLifecycle.test.ts` (logic only) | t07 | yes | REPAIR |
| voice_modal_harness_browser | deterministic modal harness | none in-browser | t07, t16 | yes | REPAIR |
| voice_playback_browser | playback after refresh, cross-student audio isolation | none in-browser | t07, t16 | yes | REPAIR |
| voice_buildlog_browser | Build-Log recordings card | screen removed `292358b` | - | yes | DELETE |
| g1_access_test.py | voice-score access control | `staging_function_authz_check.py` (partial) | t07 | yes | REPAIR |
| st.py `ST_ALG=hs256` | proves legacy HS256 is REFUSED | used by `staging_f1_check.py` | - | on purpose | KEEP_CURRENT |
| staging_jwks_secret.py | F1 setup tool | - | - | reads legacy secret | KEEP_HISTORY |
| step6dd/step6ee builders | produced applied migration files | - | - | - | KEEP_HISTORY |

Repair = sign with the staging bridge's RS256 key (`staging_token.mjs` / `st.py`); proven by read-only staging
GETs (t07 -> own row, service_role -> rows, no token -> `[]`). Full browser runs need a local
`vite --mode staging` server and were not run.

### 3.5 Duplication

Merged: the two profile-photo modals. Searched (identical function bodies of 4+ lines across live files):
none other. Deliberate per-image copies kept: `appToken.ts` (functions / files-service, CI checks identical),
`apptoken.py` (accounts / worker / transcriber), `src/lib/targetRoles.ts` (browser list).
`staging_browser_e2e.mjs` now uses the shared `staging_token.mjs` instead of its own signer copy.

### 3.6 Logging / comments

- 38 browser `console.log` removed (some printed the auth callback URL, hash parameters and user objects;
  nothing collects browser logs). `console.error/warn` kept everywhere. Server logs untouched (structured, operational).
- TODO/FIXME: none real (2 hits are the `TODO` regex in ReadableText.tsx). `debugger` / `alert(`: none.

### 3.7 Docs

| Doc | Class | Action |
|---|---|---|
| `DEPLOYING.md`, `README.md` stack/deploy | STALE_UPDATE | rewritten (Vercel/Supabase commands removed) |
| `DOCUMENTATION.md`, `RESUME_FEATURE_STATUS.md` | HISTORY | banner added |
| `docs/PRODUCTION-ARCHITECTURE.md` | CURRENT | section 0 at closure state |
| `docs/README.md` (new) | CURRENT | index: CURRENT / ROLLBACK / HISTORY |
| `HANDOFF-2026-09-19.md`, `CLAUDE.md` | CURRENT | checked: already say Vercel/Supabase are deleted |
| `HANDOFF.md`, `START_HERE.md` | HISTORY | already bannered |
| dated `docs/*-2026-10-0N.md`, `STEP6*` | HISTORY | kept as evidence; listed in `docs/README.md` |

### 3.8 Assets / config

| Item | Class | Why |
|---|---|---|
| `public/placeholder.svg` | UNKNOWN | 0 code references, but a public URL may be stored in data or external templates |
| 3 byte-identical light logos (`public/images/*.png` x2, `src/assets/logo-light.png`) | UNKNOWN | public URLs may be used outside the repo (e.g. email templates) |
| `public/robots.txt`, `favicon.ico`, `logos/*.svg` | KEEP_CURRENT | served / referenced |
| `deno.lock` | UNKNOWN | local Deno cache, not in images, CI `--no-lock` |
| `.gitignore` | updated | `e2e-out/`, `authz_matrix_results.json`, `voice-playback-fail.png` |

### 3.9 Server

| Item | Class | Why |
|---|---|---|
| all 32 functions | KEEP_CURRENT | browser / function / Scheduler / operator callers (`levels-warm` = operator via `warm_all.py`) |
| webhook-secret auth (functions + accounts) | KEEP_CURRENT | the 9 Scheduler jobs use it (secret v2); F7 is a separate change |
| `CODE_RUNNER_SECRET` path + old runner | KEEP_ROLLBACK | observation window |
| public-runner fallback | UNKNOWN | production/staging cannot reach it; local developer use not provable |
| `!USING_GOOGLE` (Supabase) branches in `backend.ts` | UNKNOWN | no deployed service takes them (`BACKEND=google` everywhere), but they sit in the shared data layer - remove in a dedicated reviewed change |
| Gemini / Kimi AI fallback in `llm.ts` | UNKNOWN | keys set nowhere; config-switchable resilience option - owner decision |
| env set but unread on functions: `GITHUB_PAT`, `STALE_AFTER_SECONDS` | config tidy | Cloud config change (approval), not code |

## 4. Database (no production change)

### 4.1 Migrations

| Migration | Drops | Status | Evidence (re-checked on this branch) |
|---|---|---|---|
| 66 | 11 proof-era tables, 8 functions, `trust_score`, FK `voice_explanations_proof_id_fkey` | prepared, not applied | no source reference; only later migration touching them is 84a (66 drops both functions); its re-created `protect_student_profiles` list = 06's minus `trust_score` |
| 71 | `voice_explanations.proof_id`, `student_portfolios.projects` | prepared, not applied | only `voiceJob.ts` compares `row.proof_id ?? null` (never selects it); `guard_voice_explanations_insert` = 65 minus one line |
| 72 | `task_applications` | prepared, not applied | no reference |
| 94 | `verification_settings`, `manual_adjustment_log` | prepared, not applied (`35905b6`) | staging: 0 functions, 0 views, 0 other policies, 0 FKs in, 0 rows; rolled-back rehearsal re-run on this branch: guards pass, both dropped inside, both back after rollback |

Order 66 -> 71 -> 72 -> 94 (71/72/94 need `legacy_archive` from 66). Each archives rows first and
refuses on any dependency. After 66: drop `_legacy_until_66` from `scripts/rpc_manifest.json`; after 71:
the `proof_id` comparison in `src/lib/voiceJob.ts` (and its test fixtures) can go; regenerate `types.ts`.

### 4.2 Deferred

| Object | Class | Why |
|---|---|---|
| `student_credits` | DEFER_DB_DELETE | 0 function refs and no app code on staging, but locked down as live by migration 86 on 5 Oct; production row count unknown |
| unused indexes | DEFER_DB_DELETE | needs production `pg_stat_user_indexes` over 30+ days |
| duplicate indexes / policies | none | structural check on staging |

### 4.3 Production runbook (owner's written yes; not before)

1. `gcloud sql backups create --instance=prooflab-db --project=prooflab-508214 --description="before 66-71-72-94"`; record the id (`gcloud sql backups list --instance=prooflab-db --project=prooflab-508214 --limit=1`).
2. Read-only "before": row counts of every table to be dropped; non-zero `trust_score` rows; non-null `proof_id`; non-empty `projects`; table and function counts; `pg_get_triggerdef` of `protect_student_profiles` (must match migration 06 - else STOP); code reference scan of the served commit.
3. Apply via the ledger wrapper, one at a time: 66, 71, 72, 94.
4. After: ledger +4, checksums match `python scripts/migrations.py plan`; `legacy_archive` grew by the archived rows; object counts dropped by exactly the listed objects.
5. `python scripts/healthcheck.py`; `attack_surface_check.py`; page walk; smoke per role (student: Daily Lot, Build-Log, portfolio, voice; college: students, squads; company: Talent, a proof profile; admin: Work, Content library).
6. Follow-up commit (section 4.1).
7. Rollback: restore the step-1 backup, or rebuild from `legacy_archive` per `66/71/72/94` rollback notes.

## 5. What must NOT be deleted (and why)

Migration files, checksums, rollback notes, ledger tools (history must stay reproducible); webhook-secret
auth (live Scheduler path); runner-secret path and old runner (rollback window); backup/restore tools,
security, attack-surface, authorization and identity checks; healthcheck; Bug Finder; step trail logging;
`st.py`'s HS256 mode (proves refusal); evidence files under `docs/` and `migration/`.
