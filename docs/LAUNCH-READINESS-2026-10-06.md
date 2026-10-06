# Launch readiness facts — 6 Oct 2026 (read-only checks; nothing was changed)

## Voice: the one failed paid case, re-run after the fix

| | |
|---|---|
| Original failure | Case K (mixed Hindi/English speech), run `055609`, 6 Oct 00:27:29 UTC, request `d35a09f1-8b33-4c2d-b540-a42c67443cb3`: `deepseek: … connection error: connection reset` → `LlmUnavailableError`, voice-score 502 in 214 ms, row `769fe3c3…` left `failed` (no retry existed then) |
| Fix | `e4e2922` `_shared/llm.ts`: a connection error returns status 0, which is retried once on the same provider after 3 s, then Gemini, then Kimi. Unit test `llm_test.ts` "a connection reset to DeepSeek is retried once, and the second answer is used": 1 passed |
| Re-run | `python scripts/dev-tools/staging_voice_cases.py --only K` at commit `bcf9a54` (+ the `--only` option, committed as `7946c2a`), staging functions image `stab-e4e2922` (revision `00065-5x6`), 16:44 UTC |
| Result | exit 0, `1/1 voice cases as expected`. Enqueue HTTP 200 (request `53286fe7…`); worker transcribed on attempt 1 (30 words, language `en`, p 0.9873, gate `english`); voice-score 200 in 1,685 ms (request `4d637595-353a-4719-a12c-17dc52f03e7b`); status `scored`, score 20, content match 30, evaluator `voice-eval-3`; one `llm_usage` row (deepseek-chat, 731 tokens) |
| Binding | voice `935e2352…` → submission `077892b9…` (status passed), same student, same task, attempt 1, `current_authoritative = true` |
| Retry behaviour | No connection error occurred in this run, so the live retry path was not exercised; it is proven by the unit test. A recording whose scoring still fails after all retries stays `failed` by design (a person can listen); the reaper re-scores only unscored (`recorded`) ones |

## Cloud Run CPU (quota `run.googleapis.com/cpu_allocation`, asia-south1)

Main project `prooflab-508214`: **20 vCPU**. Runner project `prooflab-runner-508214`: **20 vCPU**. Every service has min instances 0 and CPU only during requests, so an idle service uses no quota.

| Project | Service | max × vCPU | Max vCPU |
|---|---|---|---|
| prod | api | 4 × 1 | 4 |
| prod | functions | 4 × 1 | 4 |
| prod | files | 4 × 1 | 4 |
| prod | auth-bridge | 3 × 1 | 3 |
| prod | accounts | 2 × 1 | 2 |
| prod | transcriber | 3 × 2 | 6 |
| prod | transcription-worker | **100 (default)** × 1, concurrency 80 | 100 in theory; the queue dispatches at most 2 at a time, so 1 in practice |
| prod | code-runner (old; idle after Stage 3.1) | 6 × 2 | 12 |
| staging | api, functions, files, auth-bridge, accounts, worker, tasks-test-worker | 2 × 1 each | 14 |
| staging | code-runner (old staging runner, no longer used by staging functions) | 2 × 2 | 4 |
| staging | transcriber | 2 × 2 | 4 |
| jobs | prod bug-finder 2, prod crawler 1, staging bug-finder 1, staging crawler 1, staging-inspect4 1 | 1 task each | 6 |
| runner | code-runner-rc | 20 × 1 | 20 |
| runner | code-runner-test, code-runner-1cpu-test | 10 × 2, 20 × 1 | 40 |

- Production at its configured maximum without the old runner and with the worker at 1: 24 vCPU (above 20 only if every service hits its maximum at once). Measured on 4 Oct: 100 concurrent students used about 9 vCPU production + 11 staging.
- Staging at its maximum: 22 vCPU, all in the same 20-vCPU pool as production.

## Test services in the runner project

| Service | Image | Purpose | Callers | Last request | References |
|---|---|---|---|---|---|
| `prooflab-code-runner-test` (2 vCPU, max 10) | `code-runner@sha256:4356326c…` | 6 Oct 01:00 UTC: first containment / 2-vCPU sizing test of the dedicated runner | only `user:deploy.openfloor@gmail.com`; `RUNNER_ALLOWED_CALLERS` = same | 6 Oct 03:16 UTC (403, the anonymous-refused check) | `infra/runner/services.json`, rollout checklist note; no code, no service, no Scheduler |
| `prooflab-code-runner-1cpu-test` (1 vCPU, max 20) | same image | 6 Oct 01:06 UTC: 1-vCPU sizing comparison | same | 6 Oct 03:16 UTC (403) | same |

## task_sandbox_config on staging (5 rows)

| Config | Origin | Tests (none has `checker`) | Tasks / open / today | Submissions | Other | Class |
|---|---|---|---|---|---|---|
| `3545a46b…` grade classifier | auto | 6 | 18,340 / 17,899 / 4,105 | 483 | 1 lot template | A + B |
| `452e588c…` failed logins | auto | 6 | 3,265 / 2,865 / 0 | 441 | — | A + B |
| `d8759dbd…` audit problems | auto | 6 | 63 / 41 / 1 | 60 | — | A + B |
| `768007e1…`, `b7eacb9c…` | resume | 5 each | 0 | 0 | both named in graded resume assessment `3b96e83e…` (`coding_questions`, JSON, no foreign key) | C (historical) |

Test-case keys today: `id, stdin, expected_output, visible, weight, kind`. D (completely unreferenced): **0**.
