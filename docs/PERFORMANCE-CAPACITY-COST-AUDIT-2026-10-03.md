# Performance, capacity and cost audit — 3 Oct 2026

## 1. Configuration (CFG now)

| Item | Value |
|---|---|
| Cloud SQL | db-g1-small, ZONAL, max_connections 50 (G01 audit), 40 MB data |
| PostgREST | pool 4 × max 4 instances = **16 connections** |
| Other DB clients | none direct (accounts, functions, worker go through PostgREST); owner jobs ad hoc |
| functions / files / api | 4 instances × 80 concurrency |
| transcriber | 3 × 1 · code runner 6 × 1 · worker default × 80 |
| Voice queue | 2 concurrent, 1/s, 3 attempts |
| Nightly jobs | one call for **all colleges** (`scheduled-job`), 540 s deadline, 2 retries |

## 2. Evidence of load (EARLIER, staging = about half of production)

| Test | p95 | Errors |
|---|---|---|
| Browse 10 / 25 / 50 | 0.50 / 0.49 / 1.2 s | 0 |
| Browse 100 | 3.3 s | 1 |
| Browse 200 | 5.2 s | 0.3 % (stopped) |
| Run button 40 at once | 0.74 s (105 runs/s) | 0 |
| Voice 10 at once | all scored in 45 s | 0 |

**NOT LOAD TESTED:**
- production;
- login bursts;
- written-submit AI grading under load;
- TPO dashboards;
- recruiter search;
- concurrent CSV imports;
- nightly jobs at scale.

## 3. Analytical risks
- **Recruiter search** (`recruiter_talent`) computes per-candidate correlated subqueries (skills, tasks, proofs, submissions, voice) before paging. Fine at 100 candidates; at 1,000–10,000 it is likely slow without pre-aggregation. Unmeasured (U6).
- **Nightly all-college job:** a single 540 s call; growth will hit the deadline (F21).
- **Transcriber:** 3 × 1 with the base model gives about 13 recordings/min (staging); a class-wide submission burst will queue.

## 4. Cost

| Source | Status |
|---|---|
| Cloud SQL (prod + staging, always on) | MODELED (main fixed cost) |
| Cloud Run (CPU-on-request) | UNKNOWN actual |
| DeepSeek | **UNKNOWN: usage logging is off since 11 Sep (F3)** |
| Whisper | own compute (Cloud Run) |
| Code runner | own compute; public fallbacks free but leak data (F10) |
| Storage | small; grows with orphans (N2) |
| Logging | UNKNOWN |
| Budget guard | ₹3,000 alert (OBSERVED configured) |

Runaway controls:
- The per-user rate limits are **not active** (F3).
- Queue retries are capped (3).
- The reaper caps recovery at 8 attempts.
- The scoring lease (120 s) prevents duplicate AI calls except after a timeout.

## 5. Proposed staging load matrix (not run)

- **Steps:** 100 → 250 → 500 concurrent.
- **Flows:**
  - login;
  - Floor and Lot fetch;
  - written submit (AI stubbed and live);
  - code run;
  - voice upload, transcription and scoring;
  - Build-log;
  - TPO dashboards;
  - recruiter search with 1k and 10k seeded candidates.
- **Measure:**
  - p50/p95/p99 and 5xx;
  - DB CPU, memory, connections and slow queries;
  - Cloud Run instance counts;
  - queue delay;
  - AI latency.
- **Not on production.**
