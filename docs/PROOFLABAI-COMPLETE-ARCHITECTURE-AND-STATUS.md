# ProofLabAI — Complete Architecture and Status

**As of:** Step 6K (2026-09-26). **Audience:** the founder, and any senior
engineer picking this up cold. **Rule this document follows:** every claim
below is either something directly verified this engagement (marked
**LIVE** if confirmed in production, **STAGING** if confirmed only in
staging), something read from the code but not exercised
(**PARTIAL/BLOCKED**), or something that does not exist yet
(**PLANNED**). Nothing here is aspirational copy — where I am not sure,
I say so.

---

## 1. What ProofLab actually is

A platform for engineering students to prove they can do real work, not
just claim to. Every day a student gets one real task (drawn from an
actual job posting or interview question). They solve it, they explain
their own solution out loud for 60 seconds (the "Explain 60s" feature),
and both go into a public **build-log** — a permanent record a recruiter
can actually read, instead of a resume line that says "proficient in
React."

The core bet: a spoken explanation of your own work is much harder to
fake than a written one. That is the entire reason the voice-recording
feature (Steps 6B–6K of this hardening effort) exists and has received
this much attention — it is not a side feature, it is the thing that
makes the "proof" in ProofLab mean something.

---

## 2. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (React + TypeScript + Vite)                                │
│  - one build per environment (staging / production), flag baked in │
│    at BUILD TIME, not runtime                                       │
└──────────────┬──────────────┬──────────────┬─────────────┬──────────┘
               │              │              │             │
       (static files) │  (DB reads/  │ (functions) │ (files)
               │       │   writes)    │             │
               ▼       ▼              ▼             ▼
       ┌───────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────────┐
       │ Firebase  │ │ PostgREST│ │ functions-   │ │ files-service │
       │ Hosting   │ │ (Cloud   │ │ service      │ │ (Cloud Run,   │
       │ (static   │ │  Run)    │ │ (Cloud Run,  │ │  Deno)        │
       │  site)    │ │          │ │  Deno, 40    │ │  → GCS via    │
       └───────────┘ └────┬─────┘ │  functions   │ │    FUSE mount │
                           │       │  in one      │ └───────┬───────┘
                           │       │  process)    │         │
                           │       └──────┬───────┘         │
                           │              │                 │
                           ▼              ▼                 ▼
                    ┌─────────────────────────┐   ┌──────────────────┐
                    │  Cloud SQL (PostgreSQL)  │   │  Cloud Storage   │
                    │  - the only database     │   │  (private +      │
                    │  - "auth" schema is a    │   │   public buckets)│
                    │    compatibility layer,  │   └──────────────────┘
                    │    not real Supabase     │
                    └─────────────────────────┘
               ▲
               │ (auth-bridge exchanges a Google ID token
               │  for the HS256 token everything above uses)
               │
       ┌───────┴────────┐        ┌─────────────────┐      ┌──────────────┐
       │ Identity        │        │ auth-bridge      │      │ transcriber  │
       │ Platform        │◄───────│ (Cloud Run, Deno)│      │ (Cloud Run,  │
       │ (Google-managed │        └─────────────────┘      │  Python,     │
       │  login, project-│                                  │  faster-     │
       │  wide - staging │                                  │  whisper)    │
       │  and production │                                  └──────┬───────┘
       │  share it)      │                                         │
       └─────────────────┘                                         │
                                                                     │
       ┌──────────────────┐   ┌───────────────────┐   ┌─────────────┴────┐
       │ Cloud Tasks       │──►│ transcription-    │──►│ (calls transcriber│
       │ (staging only -   │   │ worker (Cloud Run,│   │  above, writes   │
       │  the async voice  │   │ Python)           │   │  back via         │
       │  pipeline)        │   └───────────────────┘   │  PostgREST)       │
       └──────────────────┘                             └───────────────────┘
               ▲
               │
       ┌───────┴────────┐
       │ Cloud Scheduler │  (recovery job: re-enqueues stuck
       │ (staging + prod,│   transcription/scoring jobs; also
       │  different jobs)│   the 7 daily/weekly production jobs -
       └────────────────┘   Lots, streaks, weekly reports, etc.)

       ┌──────────────────┐   ┌──────────────────┐
       │ code-runner       │   │ DeepSeek API      │
       │ (Cloud Run,       │   │ (external, primary│
       │  sandboxed code   │   │  and effectively   │
       │  execution for    │   │  only configured   │
       │  coding tasks)    │   │  LLM provider -    │
       └──────────────────┘   │  see §6)            │
                               └──────────────────┘
```

Everything runs in **one GCP project** (`prooflab-508214`). Staging and
production are not separate projects or separate Identity Platform
tenants — they are separate Cloud SQL instances, separate Cloud Run
services (distinguished by a `staging-` name prefix), and separate
Secret Manager entries, all inside the same project. This matters: it is
why Step 6H/6J had to specifically investigate what actually isolates a
staging test account from touching anything production considers real
(the database, not Identity Platform — see §9).

---

## 3. Every component, and why it exists

### 3.1 Browser: React + TypeScript + Vite
**LIVE + STAGING.** The only frontend. No server-side rendering, no
Next.js — a plain single-page app built by Vite, served as static files.
Why: the product's actual complexity is in the backend services and the
database, not in page routing or SEO; a SPA is the simplest thing that
works for a logged-in dashboard product.

### 3.2 Firebase Hosting
**LIVE (production).** Serves the built static frontend
(`scripts/deploy-hosting.py` uploads `dist/` via the Firebase Hosting REST
API, content-addressed so a redeploy only uploads changed files). Chosen
because it was already available and needs no server to run — it is a
CDN for static files, nothing more. Its **preview channels** feature
(publish to a separate temporary URL without touching the live site) is
the mechanism identified in Step 6I/6J for eventually canarying the async
voice-transcription feature to one real account before a full rollout —
**PLANNED**, not yet used for that purpose.

### 3.3 PostgREST
**LIVE + STAGING.** Turns the Postgres database directly into a REST API.
This is the single biggest architectural fact about this project: **there
is no traditional backend application server**. Every `supabase.from(...)`
call the frontend makes is a real HTTP request straight to PostgREST,
which turns it into SQL and enforces Row-Level Security (RLS) policies
declared directly in the database. Business logic that needs to run
*somewhere other than a single row* (grading, computing trust scores,
sending email) lives in the 40 Deno functions instead (§3.5).

Why this shape at all: the project originally ran on Supabase, whose
entire platform *is* "Postgres + PostgREST + Edge Functions + Auth Get out
of the way." When it moved off Supabase onto plain Google Cloud
(mid-September 2026), the cheapest way to keep 150+ files working
unchanged was to rebuild that same shape on Cloud Run/Cloud SQL rather
than rewrite the application around a conventional backend. `auth`,
`anon`, `authenticated`, `service_role` are not real Postgres features —
they are a compatibility layer (`migration/01-compat-layer.sql`, staging
only, see §9) that makes plain Postgres *behave* like Supabase's Postgres.

### 3.4 Cloud SQL (PostgreSQL)
**LIVE (`prooflab-db`, `db-g1-small`) + STAGING (`prooflab-staging-db`,
`db-f1-micro`).** The only database. Every piece of application state —
students, tasks, proofs, trust scores, voice explanations, recruiter
data — lives in one Postgres instance per environment. No separate
analytics DB, no cache layer, no search index. At current scale this is
fine; §11 covers what "current scale" actually means and does not mean.

### 3.5 functions-service (40 Deno functions, one Cloud Run process)
**LIVE (v37, 38 functions) + STAGING (40 functions — 2 more than
production, see §9).** All the business logic that is not a plain
database row: grading a proof upload (`trust-compute`), scoring a spoken
explanation (`voice-score`), the async transcription pipeline
(`transcription-enqueue`/`transcription-reap`, staging only), sending
onboarding email, running the daily "assign today's Lot" job, and 30+
more. Deliberately one process, not 40 separate Cloud Run services — see
§4 for why.

### 3.6 files-service
**LIVE + STAGING.** The only way any private file (a voice recording, a
proof upload) gets read or written. It does not talk to Cloud Storage's
API directly for the bytes — the buckets are mounted into the container
via GCS FUSE (`--add-volume=type=cloud-storage`), so from the code's
perspective a file is just a path on a local filesystem. Ownership is
enforced in code: every private path is shaped `<uid>/<filename>`, and
the service checks the caller's own subject against that prefix before
serving anything. This is also the mechanism the Build-Log's audio
playback uses (Step 6H) — an authenticated fetch that gets turned into a
`blob:` URL in the browser, never a public or long-lived link.

### 3.7 Identity Platform + auth-bridge
**LIVE + STAGING (same Identity Platform project, see §9).** Google's
managed login service issues a real RS256 ID token on sign-in.
`auth-bridge` verifies that token against Google directly and mints a
short-lived HS256 token instead — the one PostgREST, functions-service,
and files-service actually check. Why two tokens: Google's own ID token's
subject is Google's own account id, which is not the app's UUID for any
account created after the Supabase migration; the bridge is what makes
"the same person is the same UUID" survive that.

### 3.8 transcriber (Python, faster-whisper)
**LIVE + STAGING.** Runs OpenAI's Whisper model (via the faster-whisper
CPU implementation) to turn a recorded explanation into text. This is the
**only** service in the whole system that talks to an ML model running on
infrastructure ProofLab controls, rather than calling an external API —
everything else (grading, question generation) calls out to DeepSeek.
Capacity is explicitly **not validated under real load** — see §11.

### 3.9 Cloud Tasks + transcription-worker + Cloud Scheduler (async voice pipeline)
**STAGING ONLY.** This is the entire subject of Steps 6B through 6K. The
*synchronous* path (browser records → browser calls the transcriber
directly → browser inserts the transcript itself) is what's actually
live in production today, and it has a real, fixed trust gap: the
browser can insert a fabricated transcript and a fabricated score with no
recording ever happening (found and reproduced with an ordinary student
token in Step 6H). The *asynchronous* path (upload → enqueue a Cloud
Task → a dedicated worker calls the transcriber → the worker, not the
browser, writes the result back) closes that gap, because only that path
can ever write `transcript_source = 'server'`, and every downstream
consumer of a communication score (trust-compute, the recruiter-facing
functions) was fixed in Steps 6H/6I to only count that value. The async
path exists, has its own recovery scheduler for stuck jobs (with a real
lease-token fencing mechanism so a crashed worker can never overwrite a
newer result — Step 6B/6C), and has been tested thoroughly in staging.
**It has never run in production and the frontend flag that turns it on
is compiled in at build time — see §9 for exactly what stands between
here and a real rollout.**

### 3.10 code-runner
**LIVE + STAGING.** Executes student-submitted code for sandbox-style
tasks. Not touched by this engagement at all (explicitly out of scope
throughout Steps 4–6K) — its own IAM and sizing are left exactly as
found.

### 3.11 DeepSeek (external)
**LIVE + STAGING, primary and effectively only configured provider.** The
shared LLM helper (`supabase/functions/_shared/llm.ts`) code-wise supports
a fallback chain — DeepSeek, then Gemini, then Kimi — but as of this
writing **only `DEEPSEEK_API_KEY` is actually set** in either
environment's functions-service (confirmed by inspection this session).
The Gemini/Kimi fallback code exists but is inert without a key. One
documented exception in that same file's own comments: two functions
(`resume-parser`, for PDF input, and a mentioned `resume-voice-verify`)
are described as needing a multimodal model DeepSeek cannot serve — I did
**not** verify whether either of those currently has a working
multimodal key configured; flagging this as **unverified**, not broken,
since it is outside this engagement's scope.

### 3.12 GitHub API (external)
**LIVE + STAGING** for `github-check` (verifying a student's actual commit
history for a proof of work). Not otherwise investigated this engagement.

---

## 4. Why services instead of one NestJS/Next.js backend

This is a real trade-off, not an accident, and it is worth being honest
about both sides.

**What this design buys:**
- **Migration cost.** Moving off Supabase in September 2026 without
  rewriting 150+ frontend files that call `supabase.from(...)` and
  `supabase.functions.invoke(...)` was only possible because the new
  backend was shaped to look exactly like the old one. A NestJS rewrite
  would have meant touching almost every frontend file at the same time
  as replacing the entire backend — far higher risk, in a much longer
  window, for a team of effectively one engineer working across sessions.
- **No ORM, no migration framework beyond plain SQL files.** Every schema
  change is one `.sql` file (`migration/NN-description.sql`), applied in
  order, readable top to bottom. There is real cost to this too (see
  below) but for a project this size it has stayed genuinely easy to
  reason about — every migration in `migration/41` through `migration/46`
  this engagement wrote has a comment block explaining *why*, not just
  *what*.
- **PostgREST does a correct amount of the "backend" for free.** Pagination,
  filtering, embedding related rows, and — critically — permission
  enforcement via RLS are all handled by PostgREST/Postgres directly,
  which is also *why* several real security bugs this engagement found
  (Steps 6C, 6H) were fixable with a few lines of SQL rather than a
  redesign: the enforcement point was always the database, one place, not
  scattered across dozens of route handlers.

**What it costs, honestly:**
- **Discoverability.** In a NestJS/Next.js app, "what does `POST /proof`
  do" is one file. Here, the same question means checking an RLS policy,
  a trigger, a function's grants, and possibly a Deno function — four
  places, not one. Several bugs this engagement fixed (the migration-42
  privilege-reset ordering bug, the migration-43 column-vs-table-level
  revoke bug) were specifically *because* Postgres privilege semantics are
  less familiar and less discoverable than an `@UseGuards()` decorator
  would have been.
- **No framework-level request validation, DTOs, or typed contracts
  between frontend and backend** beyond what the Postgres schema itself
  enforces and what `types.ts` (generated once, now stale relative to
  migrations 41–46 — every new column needed a manual cast in the
  TypeScript this engagement wrote) describes.
- **Two separate runtimes doing "backend" work** (Deno for the 40
  functions, Python for the transcriber/worker/code-runner) instead of
  one. This is a real operational cost — two sets of dependencies, two
  deployment pipelines — accepted because faster-whisper and Python's ML
  ecosystem are the actual right tool for transcription, and rewriting a
  correct Python service in Deno to achieve stack uniformity would have
  been effort spent on the wrong thing.
- **Testing the "backend" means testing SQL migrations, RLS policies, and
  Deno functions as three different kinds of thing**, not one consistent
  test suite. Everything this engagement verified was verified by real
  HTTP calls against real deployed staging infrastructure specifically
  *because* there is no lower-cost way to exercise an RLS policy or a
  Postgres trigger than actually hitting PostgREST with a real token.

**The honest summary:** this shape was the correct choice for surviving
an emergency platform migration with a tiny team and not rewriting the
frontend. It is not obviously the right shape to keep scaling
indefinitely — the discoverability and typed-contract costs above are
real, and a future engineer inheriting this should not be surprised that
"where does X happen" sometimes takes real digging to answer.

---

## 5. Walkthrough: what actually happens

### 5.1 Signup
**LIVE.** Real Identity Platform account created → `resolve_account`
(migration 11) runs on the very first token exchange and writes an
`auth.users` row, mapping Identity Platform's own id to the app's UUID →
a `user_roles` row is created (defaulting to `student` if the signup path
did not specify a role) → the student completes a one-time intake
(`student_intake` table: welcome screen, resume-upload-or-skip) before any
dashboard route is reachable.

### 5.2 Daily task
**LIVE.** A Cloud Scheduler job (`prooflab-daily-lots`, production) calls
`assign_todays_lots` every morning, assigning each active student one real
task drawn from a job posting or interview question.

### 5.3 Proof submission
**LIVE.** Student uploads a file or pastes a link → `proof_uploads` row
created → `trust-compute` (a Deno function) is invoked, which pulls in
GitHub commit verification, AI-authorship risk, a conceptual-understanding
test score, and (this engagement's fix) **only a server-verified** voice
explanation score, and writes a single `cognitive_integrity_score` plus a
suggested action (`verified` / `needs_review` / `failed`) back onto the
proof and the student's own trust score.

### 5.4 Voice recording — the synchronous path (**LIVE in production today**)
Student records in the browser (60 seconds max) → the browser itself
calls the transcriber directly and gets text back → the browser inserts
the resulting `voice_explanations` row itself, with
`transcript_source = 'browser'` (a **BEFORE INSERT** trigger, migration
43, forces this value and a server-recomputed word count regardless of
what the browser claims — closing the "insert a wildly high word count"
half of the gap this engagement found) → if the transcript is long
enough, `voice-score` is called, which sends the transcript to DeepSeek
and writes back a `communication_score`.

**The real, fixed gap:** because the browser inserts this row itself, an
ordinary student — reproduced directly with a normal student token, no
special access — could always have inserted a completely fabricated
transcript with no recording at all, and gotten a real DeepSeek score for
it (confirmed live, Step 6H). This was never a bug in a specific line of
code; it is a structural property of "the browser writes its own grading
input." **What actually closes it** is not blocking that insert (the
synchronous experience is explicitly preserved) but making sure nothing
that matters — trust score, recruiter-visible score — trusts a
`'browser'`-sourced row (Steps 6H/6I, verified live through the real
`trust-compute` function and, in Step 6K, through a real verified
recruiter session).

### 5.5 Voice recording — the asynchronous path (**STAGING ONLY**)
Same 60-second recording, but: browser uploads the audio to private
storage → calls `transcription-enqueue`, which creates the tracking row
(`transcript_source` stays unset until the worker writes it) and a Cloud
Task → a dedicated worker (not the browser) claims the job, calls the
transcriber itself, and writes the transcript back with
`transcript_source = 'server'` → `voice-score` runs the same DeepSeek
call, fenced by a lease token so a crashed/slow worker can never overwrite
a newer attempt's result (Step 6F/6I) → the Build-Log UI (Step 6G/6H)
shows pending/processing/completed/failed states and, once complete, the
transcript, score, and a "Server-verified" vs "Self-reported" badge.

This is the path that, once live in production, actually eliminates the
gap in §5.4 rather than just fencing it off downstream — because only
this path can ever produce `'server'`. **Not live in production. See §9
for exactly what stands between here and turning it on.**

### 5.6 Recruiter search
**LIVE** (`recruiter_talent`, `recruiter_proof_profile` — real
Postgres functions, callable by any verified recruiter) **for everything
except the voice-score provenance filter, which is STAGING-only** (the fix
has not been deployed to production — migration 46 is one of the six
pending migrations in §9). Proven with a real verified recruiter session
in staging (Step 6K): a fabricated, higher-scored `'browser'` explanation
was completely absent from both the recruiter-visible explanations list
and the averaged communication score for a real test student; only the
`'server'`-sourced score for the same proof appeared.

---

## 6. Status matrix

| Area | Production | Staging | Notes |
|---|---|---|---|
| Signup, login, intake | **LIVE** | **LIVE** | |
| Daily task assignment | **LIVE** | **LIVE** | |
| Proof upload + trust-compute | **LIVE** | **LIVE** | Provenance-aware trust adjustment is staging-only until migration 41–46 ships (§9) |
| Synchronous voice recording | **LIVE** | **LIVE** | Has the fabrication gap described in §5.4; UI-side mitigation (Build-Log provenance badge) is staging-only |
| Asynchronous voice pipeline (Cloud Tasks/worker/scheduler) | **PLANNED** (not deployed) | **STAGING**, extensively tested | See §9 for exact blockers |
| Build-Log recording detail view + provenance badges | **PLANNED** | **STAGING** | |
| Recruiter search/profile | **LIVE** | **LIVE** | Provenance filter (migration 46) is staging-only |
| Verified-recruiter provenance test | — | **STAGING, PASS (Step 6K)** | Real session, real evidence, fixture retired after |
| Cross-student RLS/file isolation | **assumed LIVE** (RLS predates this engagement) | **STAGING, PASS (repeated evidence, Steps 6H/6J/6K)** | Not independently re-verified against production this engagement — see §9 |
| Scoring-claim lease-token fencing | **PLANNED** | **STAGING, PASS** | |
| Production webhook-secret rotation | **NOT DONE** | done (Step 6D) | Needs its own separate approval (§9) |
| Production DB grant-shape check (does `authenticated` have table-level UPDATE?) | **UNKNOWN — BLOCKED**, no authorized read-only access available this engagement | n/a | Exact DBA commands in `docs/step6-production-rollout-runbook.md` |
| Load testing under realistic concurrency | **NOT DONE**, anywhere | **NOT DONE** | See §11 |
| DeepSeek-only enforcement | Code supports fallback chain; only DeepSeek key configured | same | Not a hard guarantee, a configuration fact |

---

## 7. Production rollout blockers (full detail in `docs/step6-production-rollout-runbook.md`)

In the order they actually need to happen:

1. **A human with real production DB access runs the read-only grant
   check** (exact SQL provided in the runbook) — determines whether
   migration 42's `UPDATE` revoke needs a production-specific correction
   before it's applied, same shape as a bug already found and fixed in
   staging.
2. **Database backup**, before any migration touches production.
3. **Migrations 41–46**, in that dependency order (verified by reading
   each file, not by number — migration 40 is unrelated and not a
   prerequisite; see the runbook §0/§1).
4. **Production webhook-secret rotation** — its own separately approved
   change, because it also touches seven existing production Cloud
   Scheduler jobs unrelated to voice transcription.
5. New service accounts, the production Cloud Tasks queue, the worker
   deployment, the recovery scheduler — all detailed with exact resource
   names in the runbook.
6. **A real canary**, using a Firebase Hosting preview channel (the
   `VITE_ASYNC_TRANSCRIPTION` flag is baked in at build time — there is no
   way to turn it on for one production account on the main site without
   this).
7. Only after a canary produces a clean day of real metrics: wider
   rollout.

**None of this has been executed.** This document and the runbook are the
plan; executing it is future work requiring explicit approval at multiple
of the steps above.

---

## 8. Step 7 and beyond — what is NOT started

This engagement (Steps 1 through 6K) covers production-hardening of
existing features and building the asynchronous transcription pipeline
in staging. It does **not** include, and nothing in this document should
be read as claiming progress on:

- Any AI-processing **queue** beyond the voice-transcription pipeline
  described here (a separate "Step 7" AI queue is referenced in this
  project's own instructions as work in progress elsewhere — this
  engagement was explicitly told not to touch those files or interfere
  with it, and has not).
- A runtime (rather than build-time) feature-flag system, which is what
  would actually be needed to canary by account instead of by URL at
  scale.
- Any load-testing infrastructure or results.
- Any of `resume-parser`'s multimodal-provider status (§3.11) —
  unverified, not this engagement's scope.

---

## 9. Exactly what's unverified, and why

- **Production's Postgres role/grant shape** for `voice_explanations` —
  genuinely blocked on access, not on effort. Real commands are ready for
  whoever has the access.
- **Whether RLS on production actually behaves identically to staging's**
  for the cross-student isolation tests — staging's RLS policies were
  never *rewritten* in this engagement (they predate it), and the same
  policies are presumably applied to production's identical schema, but
  this was not independently re-tested against production specifically
  (correctly so — that would mean writing real rows into production for
  a test, which this engagement was never authorized to do).
- **Whether a second real student's Identity Platform sign-in shows the
  identical cross-student result an authenticated-session query already
  showed** — Steps 6H/6I/6J deliberately did not reset a second staging
  account's password to get this, since staging and production share one
  Identity Platform project and that reset is treated as a real,
  non-trivial action requiring its own approval. The equivalent RLS
  result was proven from the querying side instead (a real student's
  real session, real requests, real denial) — a slightly narrower claim
  than "two independent browser sign-ins," stated as such rather than
  rounded up.
- **Everything in §11** (load/capacity).

---

## 10. What "1,000 students" actually needs before anyone promises it

None of the following exists yet. Listing them precisely so a promise to
a college or investor is never made ahead of evidence:

1. **A real load test of the transcriber.** Its current production sizing
   (2 CPU, 2Gi memory, `maxScale: 3`, concurrency 1 — i.e., **3 concurrent
   Whisper transcriptions, maximum, ever**) happens to match staging's,
   which is a coincidence of both having been sized the same way
   originally — **not evidence it has been exercised under load** (this
   exact point was a correction this engagement made to its own earlier
   draft of the rollout runbook, twice, because it kept getting stated as
   more solid than it is). 1,000 students each recording once a day, even
   spread across a working day, will produce concurrent bursts around
   deadline times that 3-way concurrency has never been asked to handle.
2. **A real load test of Cloud SQL** under concurrent PostgREST traffic at
   that scale — `db-g1-small` in production has never been benchmarked
   this engagement is aware of.
3. **A real canary result** (§7, step 6) — the *async* pipeline specifically,
   since that is the path intended to eventually replace the synchronous
   one for real.
4. **A real answer to "what happens when the transcriber's 3-concurrency
   limit is hit at scale"** — right now the queue's own backoff (Cloud
   Tasks, staging-only) absorbs this gracefully in testing; the
   synchronous production path today has no queue at all, and a burst
   past capacity there means those specific browsers see the transcriber's
   own 429/503 responses directly (`transcribeAudio.ts` already retries
   these with backoff — accordingly tested only at low concurrency).
5. **DeepSeek's own rate limits and cost at that volume** — not modeled
   this engagement.

Until 1–4 above have real numbers behind them, "this can handle 1,000
students" is a claim this document explicitly does not make.
