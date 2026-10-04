# 2,000-student concurrency report

4 Oct 2026, staging (`prooflab-staging-*`). The functions run commit `b89219d`. Release target: **2,000 students on the current 20-vCPU Cloud Run quota**, which staging shares with production. Infrastructure was not changed for this test. No quota was requested.

**Verdict: 2,000 CONCURRENT STUDENTS: NOT PROVEN.**
- Highest clean sustained level: **100**.
- First failing level: **250**, on voice processing time.
- Bottleneck: voice transcription, starved by the shared 20-vCPU quota.

---

## 1. What was tested

**Population**
- Synthetic "Load Student 1..2000": 10 LOADTEST colleges, 6 branches, squads formed by the product's own `form_squads`. No real student data.
- Each student got one fresh task per stage (`staging_journey_2k_prep.sql`, ids `10ad2000-…`, titles `LOAD2K s<stage> …`):
  - two of every three are coding tasks (two real generated Python problems);
  - one of every three is written (two real generated rubrics).

**Journey** (`staging_journey_2k.py`). Every virtual student is a different student with their own ticket:

1. Floor: today's Lot, week, task list.
2. Open the task, read 20–60 s.
3. Coding: write 40–120 s, then Run 1–3 times, 20–50 s apart, then Submit. Written: write 60–150 s, then Submit.
4. Record voice: upload the file, queue it.
5. Look at the result every 10–20 s.
6. Build-log, Squad, Profile.
7. Idle 20–60 s, then back to Floor.

Students start spread over the first 60 s. Nobody presses Submit at the same moment in the sustained test.

**What each student submits is fixed in advance, so it can be checked:**
- Every 10th coding student submits a hard-coded "print the example" program. It must fail.
- The rest submit the reference solution. It must pass with 100.
- Every 10th written student submits an off-topic answer. It must score ≤ 40.

**Workload mix — documented assumption, not measured product data.** One journey per student per stage. The resulting request mix, measured in stage 2:

| Activity | Share of requests |
|---|---|
| Reading Floor / Build-log / Squad / Profile | 63% |
| Waiting for the voice result (polling) | 20% |
| Run | 4% |
| Submit (code 2%, written 1%) | 3% |
| Voice upload + queue | 6% |
| Opening a task | 3% |

Real usage data per activity does not exist yet: the `app_events` trail has no per-activity rates for a 2,000-student cohort.

**Production protection**
- Every 30 s the tool read production logs for 5xx, 429, "no available instance" and quota errors. Any hit stops all users (abort file).
- vCPU held by each environment was sampled from Cloud Monitoring.
- **Production showed zero 5xx / 429 / start failures in every stage and burst.**

---

## 2. PROPOSED RELEASE SLO

No performance SLO exists in the repository (searched `docs/`). These are proposed for this release, separately per kind of work:

| Kind | PROPOSED RELEASE SLO |
|---|---|
| Page / API reads | p95 ≤ 1.5 s, p99 ≤ 3 s, errors (5xx + 429 + timeouts) ≤ 1% |
| Run | p95 ≤ 8 s, errors ≤ 2% |
| Submit (code) | p95 ≤ 15 s, errors ≤ 2% |
| Submit (written, AI) | p95 ≤ 25 s, errors ≤ 2% |
| Voice upload + queue | p95 ≤ 5 s, errors ≤ 1% |
| Voice processing (asynchronous) | 95% scored within **5 minutes** of upload; none lost |

Hard requirements, whatever the latency:
- zero cross-account leaks;
- zero wrong-owner submissions or recordings;
- zero hidden-test leaks;
- zero lost authoritative submissions;
- zero unexplained score corruption;
- zero production impact.

---

## 3. Ramp results (sustained, realistic journeys)

| Concurrency | Result | p50 | p95 | p99 | 429 | 5xx | Timeouts | CPU (staging peak) | DB | Runner | Voice (upload → scored) | Correctness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **100** | ✅ **PASS** | 79 ms | 415 ms | 1,003 ms | 0 | 0 | 0 | API 7%; 11 of 20 vCPU held by staging, 9 by production | CPU 16%, memory **100%**, 5 connections | 141 Runs + 67 Submits, all 200; p95 444 / 687 ms | 97/97 scored; p50 78 s, p95 207 s | 0 problems; 67/67 code verdicts right; 30 written graded |
| **250** | ❌ **FAIL (voice SLO)** | 99 ms | 385 ms | 1,021 ms | 0 | 0 | 0 | API 13%; 11 / 9 vCPU | CPU 26%, memory **100%**, 6 connections | 346 Runs + 167 Submits, all 200; p95 406 / 652 ms | 249 scored + 1 AI failure (no score); p50 **5.4 min**, p95 **11.5 min** | 0 problems; 167/167 code verdicts right; 83/83 written as expected |
| 500 | NOT RUN — the ramp stops at the first failing level | | | | | | | | | | | |
| 750 | NOT RUN | | | | | | | | | | | |
| 1000 | NOT RUN | | | | | | | | | | | |
| 1250 | NOT RUN | | | | | | | | | | | |
| 1500 | NOT RUN | | | | | | | | | | | |
| 1750 | NOT RUN | | | | | | | | | | | |
| 2000 | NOT RUN | | | | | | | | | | | |

Stage details: `e2e-out/load2k/s1-report.json`, `s2-report.json`.

Durations:
- Stage 1: 527 s, 3,260 requests (6.2/s).
- Stage 2: 482 s, 8,242 requests (17.1/s).
- Each was measured after a 60 s ramp-in.

Everything a student waits for on screen (reads, Run, Submit, upload) was inside the SLO at 250. Only the asynchronous voice result was late.

---

## 4. Controlled bursts (everyone at the same second)

Each user is a different synthetic student (`staging_burst_2k.py`, one client process per 50 users so the test machine is not the limit).

| Burst | Result | p50 | p95 | Errors |
|---|---|---|---|---|
| 200 students browsing nonstop (15 reads each, no pause) | ✅ | 402 ms | 1.36 s | 0 |
| 500 students browsing nonstop | 🟡 | 766 ms | 3.70 s | 0 |
| 1,000 students browsing nonstop | ❌ | 1.1 s | 14.6 s | **8,946 × 429, 340 × 504** (API at its 2-instance maximum) |
| 50 / 100 / 200 students press Run at once | ✅ | 2.2 / 2.7 / 5.1 s | 2.9 / 4.0 / 7.6 s | 0 |
| 100 students press Submit at once | ✅ | 9.7 s | 11.0 s | 0 |
| 200 students press Submit at once (100 had already passed) | ✅ | 4.1 s | 11.2 s | 0. The 89 already-passed students got 409 "already completed": duplicate protection works |
| 100 recordings uploaded at once | 🟡 | upload 5.2 s, queue 0.5 s | upload 7.6 s | 0; all 100 scored, **but p95 22.6 minutes** |

A browsing burst with no pause between reads is far heavier than real students. 1,000 nonstop browsers ≈ 160 requests/s. For comparison, the realistic journey made 0.07 requests/s per student.

## 5. Code + Voice interference

Measured while 100 recordings were being transcribed and scored, against the same burst with the voice queue idle:

| Test | Voice queue idle | Voice queue busy | Effect |
|---|---|---|---|
| A. browsing + code (mixed 200: 100 Run + 100 browsing) | — | Run p95 4.5 s, reads p95 1.4 s, 0 errors | none visible |
| B. Run burst 100 | p95 3.96 s | p95 4.44 s | +12% |
| C. Submit burst | 100 at once p95 11.0 s (idle) | not repeated | — |
| D. voice upload while runner busy (stage 2 sustained) | — | upload p95 811 ms | none |
| E. reads burst 200 | p95 1.36 s, 0 errors | p95 1.58 s, **32 × 429** | slight; the 429s are the API instance cap |
| F. realistic mixed (stage 2) | — | all on-screen work within SLO | voice result late |

Voice does not noticeably slow coding: the runner and the transcriber are separate services. They compete only for the **shared vCPU quota**.

---

## 6. Correctness under load (after every stage and burst)

Checked for **every** student in each stage by `staging_journey_2k_report.py`: student → task owner → submissions (owner, task, evaluator type, runner, expected verdict, at most one pass) → recordings (owner, bound to that student's submission of that task, one authoritative) → every accepted Submit and every accepted recording has its row.

| Check | Stage 1 (100) | Stage 2 (250) | Bursts (311 submits, 100 recordings) |
|---|---|---|---|
| Task owned by the right student | 100/100 | 250/250 | — |
| Submission owner = task owner | 97/97 | 250/250 | 211/211 |
| Right evaluator; code graded by ProofLab's runner | ✅ | ✅ | ✅ |
| Correct code passed with 100, hard-coded code failed | 67/67 | 167/167 | 211 passed (all correct code) |
| Written graded as expected | 30/30 | 83/83 | — |
| More than one passed submission per task | 0 | 0 | 0 (89 duplicate Submits refused) |
| Recording bound to the student's own submission of that task | 97/97 | 250/250 | 100/100 |
| More than one authoritative recording per submission | 0 | 0 | 0 |
| Accepted Submit or recording with no stored row (lost) | 0 | 0 | 0 |
| Failed recording carrying a score / scored without a score | 0 | 0 | 0 |
| Same score in DB, student Build-log, Profile, TPO, admin (25 sampled per stage) | 0 differences | 0 differences | — |

Company view: the synthetic students are not visible to companies ("No candidate found"). Those that were visible matched.

Hidden tests: no Run or Submit response carried hidden data. The coding audit proved this separately (`EVALUATION-ENGINE-AUDIT.md` §2.2).

Suspended accounts: blocked. Proven by the release gate's 23 checks, not repeated under load.

Representative traces ("what happened to Student X"): `e2e-out/load2k/traces-s2.md`. It covers students 1 (code, passed 100, voice 78), 3 (written 100, needs_review because the answer is identical to others: copy detection), 10 (hard-coded code, failed 13) and 30 (off-topic written, failed 0). Each shows every request with time, HTTP code and latency, the stored grade, the bound recording and the student's own Build-log answer. Tool: `staging_student_trace.py`.

## 7. Failure and retry under load

| Case | Seen | Result |
|---|---|---|
| AI connection reset (DeepSeek) during voice scoring, stage 2 | 1 of 250 | Recording marked failed, **no score**, student told "Scoring failed". Not retried automatically (weakness V6) |
| Transcriber full (429) | 21–109 times per run | Worker answers 500 and Cloud Tasks retries. Nothing lost, nothing duplicated; slow |
| Duplicate Submit after a pass | 89 | 409, no second row |
| Runner busy | 0 under these loads | would answer 503, nothing saved |

---

## 8. Bottlenecks, in the order they bite

1. **Voice transcription vs the shared quota (first failure, at 250).**
   - Measured (corrected 4 Oct evening):
     - Production holds 9–11 vCPU idle; staging holds 3 at true rest.
     - Staging rises to 8–13 while instances from a previous test are still warm. During these runs, staging + production reached 20 of 20.
     - At a clean idle moment the total was 14 of 20 (about 6 free).
   - So the staging transcriber can never start its second instance: one instance, one recording at a time, about 18 recordings/minute.
   - The queue sends 2 at a time. The second one gets 429, the worker returns 500, and Cloud Tasks backs off up to 120 s. Under a burst this collapsed throughput to about 4.4 recordings/minute.
2. **API instance cap × database pool.**
   - Staging API maximum is 2 instances with a pool of 2 connections each. Above roughly 500 nonstop browsers, requests queue for a connection (server p95 10.4 s) and then are refused with 429.
   - Database CPU stays under 40%. The pool is the limit, not the database.
3. **Staging database memory at 100%** (db-f1-micro, about 614 MB, holding the historical 15,000-student dataset).
   - Its speed swings: the same nightly-Lots run took 48 s once and 243 s twenty minutes later.
   - Not the first limit for students, but it makes staging timings noisy.
4. **Code runner:** not a bottleneck here. 200 simultaneous Runs answered within 8 s on 2 instances.
5. **Authentication:** tickets were minted with the staging signing key. **Real sign-in through Identity Platform at scale was NOT tested**: staging shares the login pool with production and has no logins (see `CLOUD-CAPACITY-PLAN.md`).

Behaviour under the current 20 vCPU:
- At clean idle, staging (3) + production (9–11) leave about 6 vCPU free. Staging's instances from a previous test, still warm, used that up during these runs.
- Any staging load test can start new instances only when idle instances have shut down.
- During this test production still never failed. Its services already had warm instances and production traffic was light.
- A production traffic spike during a staging load test would find no free quota. That is a real risk, and the reason the long-term fix is a separate staging project.

## 9. Safe release limits (from what was measured)

| Activity | Safe on today's setup | Evidence |
|---|---|---|
| Students working at the same time (reading, Run, Submit) | **250** sustained, with every on-screen action within SLO | stage 2 |
| Students recording voice at the same time | **About 100 in a 7-minute window** for results within 5 minutes; larger groups get their voice result late (250 → p95 11.5 min; 100 at the same second → 22 min) but it is never lost | stage 1–2, burst |
| Run at the same second | 200 | burst |
| Submit at the same second | 200 | burst |
| Browsing at the same second, no pauses | 500 (p95 3.7 s) | burst |

Production has a larger setup than staging (API 4 instances / pool 4, transcriber up to 3, runner up to 6). It is held back by the same shared quota. These staging numbers are a floor, not production's ceiling. They were **not** measured on production.

## 10. Smallest next fixes (none applied; each needs the owner's yes)

1. **Voice queue matches what can actually run.** Set staging and production transcription queue `maxConcurrentDispatches` to the transcriber instances that can really start, or let one transcriber instance take 2 jobs. This removes the 429 → backoff collapse. No extra vCPU.
2. **Staging in its own Google Cloud project**, or at least `max-instances` 0 / scale-to-zero on idle staging services outside test windows. This frees the vCPU staging instances hold while warm after a test (up to about 11 measured; 3 at true rest). Without it, a 2,000-student test cannot run on staging without risking production.
3. Then re-run this ramp: `staging_journey_2k.py <stage> <users>` + `staging_journey_2k_report.py <stage> --wait-voice 1800` for 250 → 2,000.

## 11. Simple student experience: "If 2,000 students use ProofLabAI at the same time, what happens?"

Measured up to 250 at once (sustained) and up to 1,000 at once (bursts). 2,000 at once was **not reached**.

| Step | | What a student would see |
|---|---|---|
| Login | 🟡 | Not tested at scale on staging. Real sign-in needs production's login pool |
| Floor | ✅ | Opens in about 0.1 s at 250 students; slows past ~500 nonstop browsers; refused (429) at 1,000 |
| Lot | ✅ | Same as Floor |
| Task | ✅ | Opens in about 0.1 s |
| Run | ✅ | 0.3 s normally; up to 8 s when 200 press Run in the same second |
| Submit | ✅ | Code 0.5 s, written 1.4 s; up to 11 s when 200 press Submit together. Correct marks every time; a second Submit after a pass is refused |
| Voice | 🟡 | Upload always works. The result takes 1–3 minutes for a class of 100, but **5–23 minutes** for 250 or a whole class recording at once |
| Score | 🟡 | Coding and written scores are correct, consistent and immediate. But a subtly wrong program can pass at the 80% mark, and the Voice score cannot be explained criterion by criterion (`EVALUATION-ENGINE-AUDIT.md`) |
| Build-log | ✅ | Shows exactly the stored score and the student's own recording; never anyone else's |
| Squad | ✅ | About 0.1 s |
| Profile | ✅ | About 0.1 s; the same numbers as TPO and admin |

## 12. Historical note

The 15,000-student runs from 3 Oct (`CLOUD-CAPACITY-PLAN.md`, `staging_load_15k.py`) were real scalability experiments. They stay as history and are not this release's target. The batching built for them (daily Lots in batches, migration 76) is kept.
