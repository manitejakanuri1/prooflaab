# Security F1–F21 revalidation + D1–D5 (3 Oct 2026)

Read-only, at HEAD `d736e4d`.
- **RUN today:** anonymous/forged attack surface 66/66; `/ready` 40/40.
- **Not run:** no exploit was attempted against production.

"Architecture change" means the design must change. "Hardening" means the current design stays and gets tightened.

| F | Title | Current status | Evidence | Actual impact | Depends on | Architecture or hardening |
|---|---|---|---|---|---|---|
| F1 | Shared HS256 secret signs tickets and service_role | **CONFIRMED_OPEN (prod)** | SRC: `backend.ts:55-71`, worker `mint_token`, `crawler/db.py`, bug-finder; CFG: 10 secret readers | RCE in any of 10 runtimes = full DB | — | **Architecture** (asymmetric signer; service identity) |
| F2 | All functions use service_role | **CONFIRMED_OPEN** | SRC: `createClient` ignores its args in Google mode | every authz bug = data exposure (5 historic) | F1 | **Architecture** |
| F3 | Rate limit / AI usage / cache / audit off | **CONFIRMED_OPEN, PRODUCTION_VERIFIED, root cause found** | SRC: `llm.ts:87-89,261`, `rate-limit.ts:56-58`, `audit.ts:29-31` read `SUPABASE_*`; CFG: absent; DATA: llm_usage last 11 Sep, rate_limits 0, 0 server security events | no per-user AI/code caps, no cost data, no server security trail | — | **Hardening** (route through `backend.ts`; fail loudly) |
| F4 | Email pre-registration takeover at import | **CONFIRMED_OPEN (code)**; live NT | SRC: `create-student-users:141-220` | identity capture of an imported student | — | **Hardening** |
| F5 | Browser self-claims roles | PARTIALLY_CONFIRMED | SRC: `user_roles_self_claim`; approval gates | limited by approval | — | Hardening |
| F6 | Sync deletes without a ceiling | **CONFIRMED_OPEN** | SRC: `accounts/server.py:201-217`; hard delete with cascade (migration 17) | a partial Identity response wipes students | — | Hardening |
| F7 | Static scheduler secret, `!==` compare | **CONFIRMED_OPEN**, **impact raised** | SRC: `scheduled-job:36`, `transcription-reap:38`; **`accounts /password-link` returns a reset link for any email to any holder** | secret leak = run jobs **+ take over any account** | F1 (shared readers) | Hardening (OIDC) |
| F8 | Runner leftover processes | **CONFIRMED_OPEN (code)**; live NT | SRC: `code-runner/server.py:85-95` | cross-student interference on a reused instance | — | Hardening |
| F9 | Runner memory/egress/metadata | **CONFIRMED_OPEN (config)** | SRC: no `RLIMIT_AS`; CFG: no VPC/egress; metadata reachable (INFERRED) | a student program can reach the internet/metadata (runner SA has no roles, which limits the blast) | — | Hardening |
| F10 | Public runner fallbacks for graded code | **CONFIRMED_OPEN** | SRC: `sandbox.ts:268-306` | hidden tests and student code leave ProofLab | — | Hardening (disable in prod) |
| F11 | Scored audio mutable | **CONFIRMED_OPEN (code)** | SRC: `files-service/main.ts:263,309` | evidence can change after scoring | — | Hardening (write-once) |
| F12 | Browser voice path still scoreable | **CONFIRMED_OPEN** | SRC: `voice-score:95-101`; DATA: 0 browser rows | self-reported transcripts could be scored and counted by recruiters | decision on migration 46 | Hardening + product decision |
| F13 | Whisper base, forced English | CONFIRMED_OPEN | SRC: `transcriber/server.py:29,57` | accuracy for Indian English / Telugu-English UNKNOWN | — | Hardening / model choice |
| F14 | Prompt injection / no AI timeouts | **CONFIRMED_OPEN** | SRC: single `user` message; no AbortSignal; only written grading has tags | hung provider holds requests up to 300 s; injection on resume/transcript | — | Hardening |
| F15 | Personal data to DeepSeek | CONFIRMED (legal review) | SRC: full resume, answers, transcripts | cross-border PII | — | Product/legal + minimisation |
| F16 | CI tests Node 22, deploy builds Node 20; backends not built by CI | **CONFIRMED_OPEN** | SRC: `deploy.yml:44,78`; Deno tests only `_shared/` + `transcription-reap/`; backend images built by hand | untested artifact shipped | — | Hardening (pipeline) |
| F17 | No single schema source | **CONFIRMED_OPEN** | SRC: 2 folders, three 49s, no applied table | drift, unrepeatable DB | — | Hardening (process) |
| F18 | No IaC | **CONFIRMED_OPEN** | SRC | console drift (2 leftovers found today) | — | Hardening (process) |
| F19 | Non-transactional student creation | CONFIRMED_OPEN (mitigated) | SRC: createUser then inserts; `drop_empty_account` | half-created accounts | — | Hardening |
| F20 | Fire-and-forget logging | CONFIRMED_OPEN | SRC: `void logUsage`, `void writeCache` | lost rows after F3 is fixed | F3 | Hardening |
| F21 | Capacity unproven | PARTIALLY_CONFIRMED | CFG: 16/50 connections; EARLIER: staging ≤ 200 | unknown production limits | — | Measurement |

## New findings today (not in F1–F21)

| ID | Finding | Evidence | Severity (proposed) | Class |
|---|---|---|---|---|
| **N20** | Resume answer keys and hidden coding tests sit on a row the student may read (and by policy UPDATE) through PostgREST: `resume_assessments_own_all FOR ALL`; `id = user_id` for 17/17 | SRC + DATA (50 keys, 60 tests stored); **live NOT TESTED** | **P1 candidate** (verify on staging) | Hardening (column grants / move keys to a private table) |
| N21 | Resume coding Submit returns hidden tests' stdin/expected/actual; templates shared per profile | SRC: `resume-code-execute:139-150, 200-210` | P2 | Hardening |
| N22 | Resume coding tests are not validated against a reference solution; TypeScript is mapped but cannot run | SRC | P2 / P3 | Hardening |
| N23 | Test sets can accept constant output (identical stdin/expected across visible and hidden) | DATA (sandbox config sample) | P2 | Hardening (test-quality check) |
| N24 | Sponsored Lots results invisible to the recruiter (`recruiter_lots` reads `proof_uploads`); Sponsored/company tasks graded by the generic checklist | SRC | P1 (same family as L1) | Replace |
| N25 | `accounts /password-link`: reset link for any email to any webhook-secret holder | SRC | P2 (raises F7) | Hardening |
| N26 | Deep bug-finder trigger fails with PERMISSION_DENIED (code 7) | CFG | P3 | Hardening |
| N27 | Session incl. Google refresh token in `localStorage` | SRC: `identity.ts:100-110` | P3 (XSS impact) | Hardening |
| N28 | Staging and production share the DeepSeek and GitHub-PAT secrets | CFG (secret IAM) | P3 | Hardening |
| N29 | Leftover staging resources (`staging-inspect4` job, `staging-ai-background` queue, `staging-tasks-test-worker`) | CFG | P4 | Cleanup |
| N30 | Lot wording: impossible "submit a file" deliverables, unseen "attached article", fabricated premises | DATA | P2 (product quality) | Hardening (validator) |

## D1–D5

| D | Result | Tag |
|---|---|---|
| D1 | PDR's "43–54 / 66 files" is wrong. `migration/` has 66 files, highest **49** (three 49 files); `supabase/migrations/` has 139 | SRC |
| D2 | 12 production + 1 staging scheduler jobs = 13 | CFG (re-read today) |
| D3 | **No 5.5 h shift**: all jobs `Asia/Kolkata` | CFG |
| D4 | No `roles/editor` anywhere (CFG today); `docs/PRODUCTION-ARCHITECTURE.md` stale; the compute SA still reads every production secret (N14) | CFG |
| D5 | Confirmed: `proofs/` object (1), UploadProofModal (unreachable), `proof_uploads` + readers, 9 functions | SRC + CFG |

## Counts after revalidation

| Severity | Before today | After today |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 5 (F1, F3, F4, F8, L1) | **7**: F1, F3, F4, F8, L1, + N20 (candidate, pending staging proof), + N24 (L1 family) |
| P2 | 14 | **19**: + N21, N22, N23, N25, N30 |
| P3 | 17 | **20**: + N26, N27, N28 |
| P4 | 9 | **10**: + N29 |
| UNKNOWN | 9 | **11**: + U10 (N20 live exploitability), U11 (deep-run IAM cause) |
