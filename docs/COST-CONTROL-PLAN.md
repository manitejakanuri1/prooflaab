# Cost control plan

> **Release target (4 Oct 2026): 2,000 students** on the current 20-vCPU quota. The 15,000-student figures in this document come from a historical scalability experiment on staging (real runs, kept as evidence). They are not this release's target, and no quota request is part of this release. Current evidence: `CONCURRENCY-2000-REPORT.md`.


3 Oct 2026. **Estimates built from staging measurements — not a bill.** The owner decides the budget; nothing about the budget or the product's behaviour was changed.

## What was measured (staging `llm_usage`, DeepSeek list price, ₹84 per US$)

| AI call | Avg tokens in / out | ₹ per call | When it happens |
|---|---|---|---|
| Voice scoring | 849 / 84 | 0.027 | once per recording that passes the English and silence checks |
| Written-answer grading | 628 / 159 | 0.029 | each Submit of a written Lot |
| Simple-words explanation of a task | 387 / 396 | 0.045 | once per task, then stored |
| Writing a Lot from a page | 993 / 626 | 0.080 | once per source page, shared by everyone |
| Resume coding round | 559 / 727 | 0.080 | once per resume |
| Company Lot | 964 / 935 | 0.108 | once per Lot a company sets |
| Help chat | 186 / 16 | 0.006 | per message |

Not AI: coding Lots are graded by the code runner (CPU only). Silence, non-English and off-limit recordings cost no AI call (checked before spend).

Transcription (Whisper `base`, 2 vCPU, 2 GiB): 30 recordings of 17 s were scored in 73 s on 2 instances — about 4.9 instance-seconds per 17-second clip. A 60-second clip is estimated at 17 instance-seconds, about **₹0.075 per recording** at Cloud Run list prices. This is an extrapolation; real 60-second speech has not been timed.

Everything spent on AI during the whole stabilization programme on staging: about ₹4.

## Scenarios (per month, 30 days)

Assumptions: one Lot per active student per day; half written, half coding; average 1.3 submissions per written Lot; one recording per Lot; 3 new source pages a day; 20% of students use help chat (3 messages).

| | Pilot (300 students, 60% active) | 15,000 students, 10% active | 15,000, 40% active | 15,000, 100% active |
|---|---|---|---|---|
| Active students a day | 180 | 1,500 | 6,000 | 15,000 |
| Written grading | ₹100 | ₹850 | ₹3,400 | ₹8,500 |
| Voice scoring | ₹150 | ₹1,200 | ₹4,900 | ₹12,200 |
| Transcription | ₹400 | ₹3,400 | ₹13,500 | ₹33,800 |
| Lot writing, explanations, chat | ₹50 | ₹100 | ₹250 | ₹500 |
| **AI + transcription** | **about ₹700** | **about ₹5,500** | **about ₹22,000** | **about ₹55,000** |
| Always-on services (API, bridge, files, functions idle time), database, storage | about ₹2,500–3,500 at today's sizes; a larger database tier for the 40–100% cases adds roughly ₹3,000–6,000 | | | |

Largest line in every scenario: transcription (about 60%).

## Where money can leak, and the guard that exists

| Risk | Guard today |
|---|---|
| A student hammering Run or Submit | per-student rate limits (Run 120/hour) — working since the telemetry fix |
| The same AI answer bought twice | AI cache; Lots and explanations written once and stored |
| AI called for junk recordings | silence / too-few-words / repetition / non-English checks run first |
| AI spend invisible | `llm_usage` is written again for every call, including scheduled jobs (fixed in this phase); alert "AI usage is not being recorded" |
| Runaway instances | maximum instances per service (the worker still needs one — see capacity plan) |
| A stuck AI provider holding requests | 90-second timeout per attempt; alert "AI calls are timing out" |

## Recommended alert thresholds (for the owner to set)

| Budget alert | At |
|---|---|
| Monthly budget | owner's figure (today ₹3,000 — below even the 10%-active scenario) |
| Notify at | 50%, 80%, 100%, and 120% |
| Daily AI calls (from `llm_usage`) | warn at 2× the trailing 7-day average |
| Transcription minutes per day | warn at 2× the trailing 7-day average |

## Levers if cost must come down (decisions, not done)

| Lever | Saves | Cost to the product |
|---|---|---|
| Require the explanation only on passed Lots (today: after a pass, optional otherwise) | already the case | — |
| Cap recordings at one scored attempt per submission per day | part of voice scoring + transcription | fewer retries |
| Scale the transcriber to zero between peaks (already the case) | idle cost | first recording after idle waits about 5 s |
| Smaller or larger Whisper model | unknown until the benchmark | accuracy — needs the real-audio benchmark |

## Owner decision required

`OWNER_DECISION_REQUIRED`: the monthly budget for the target number of students. The ₹3,000 alert stays as it is until then.
