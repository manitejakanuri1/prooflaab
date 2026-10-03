# Cloud capacity plan

3 Oct 2026. Source: `infra/production/services.json`, `infra/staging/services.json` (read from the live project) and the staging load tests. **Nothing here has been changed in production and no quota request has been made** — that is the owner's action.

## The limit today

| | |
|---|---|
| Quota | Cloud Run "total CPU allocation per project per region": **20 vCPU**, `asia-south1` |
| Shared by | production **and** staging (one project) |
| What happens when it is used up | Cloud Run cannot start a new instance. Requests get **429 "no available instance"** or **503 "exceeded its quota"**, and a new revision cannot be deployed ("Quota exceeded for total allowable CPU"). Instances already running keep serving. |
| Seen for real | 3 Oct, staging load test: staging could not start instances for about 8 minutes and one deploy was refused. Production showed no errors (checked in logs). |

## What the services may ask for today

| Service | vCPU | Max instances | Could use | Note |
|---|---|---|---|---|
| prooflab-api | 1 | 4 | 4 | |
| prooflab-functions | 1 | 4 | 4 | |
| prooflab-auth-bridge | 1 | 3 | 3 | |
| prooflab-accounts | 1 | 2 | 2 | |
| prooflab-files | 1 | 4 | 4 | |
| prooflab-code-runner | 2 | 6 | 12 | |
| prooflab-transcriber | 2 | 3 | 6 | |
| prooflab-transcription-worker | 1 | **no limit set (100)** | 100 | must be bounded |
| **Production total** | | | **35 + the unbounded worker** | already above 20 |
| Staging (9 services, 1–2 vCPU, max 2 each) | | | 22 | |

So production cannot reach its own configured maximums even with staging idle.

## Recommended maximums (bounded, sized for about 15,000 students)

Basis: staging measured about 150 API calls/second on 2 instances with a database pool of 2 each; 42 code runs/second on 2 runner instances; 24 recordings/minute on 2 transcriber instances. A real student makes roughly one call every 30–40 seconds while active.

| Service | vCPU | Recommended max | vCPU | Why |
|---|---|---|---|---|
| api | 1 | 6 | 6 | about 450 calls/s; needs the database pool raised with it (see below) |
| functions | 1 | 6 | 6 | AI calls hold a request for seconds |
| auth-bridge | 1 | 3 | 3 | every sign-in and every service token |
| accounts | 1 | 2 | 2 | background sync only |
| files | 1 | 4 | 4 | uploads of recordings |
| code-runner | 2 | 8 | 16 | one run at a time per instance; evening peak of Submit |
| transcriber | 2 | 6 | 12 | about 70 recordings/minute; a 60-second clip takes longer than the 17-second test clip |
| transcription-worker | 1 | **4** | 4 | only forwards; the queue already limits it to 2 at a time |
| crawler + bug-finder jobs | 1–2 | 1 each | 3 | short runs |
| **Production peak** | | | **56 vCPU** | |

## Recommended quota request

| Item | vCPU |
|---|---|
| Production peak (table above) | 56 |
| Deploy headroom (a new revision starts beside the old one) | 12 |
| Staging, while it shares the project | 22 |
| Safety margin (about 10%) | 10 |
| **Ask for** | **100 vCPU** in `asia-south1` |

If staging moves to its own project (recommended below), 80 vCPU is enough for production.

How to ask (owner): Console → IAM & Admin → Quotas → filter "Cloud Run Admin API", "Total CPU allocation, in milli vCPU, per project per region", region `asia-south1` → Edit → 100000 (milli vCPU), with the justification "production education platform, 15,000 students, measured peak 56 vCPU".

## Changes that go with it (each needs approval; none made)

| Change | Why |
|---|---|
| Set `--max-instances=4` on `prooflab-transcription-worker` | it is unbounded today |
| Raise the API's database pool (`PGRST_DB_POOL`) from 4, and the Cloud SQL tier so it allows the connections (6 instances × 10 = 60 connections; `db-g1-small` allows about 50) | at 400 simulated users the 2×2 staging pool was the bottleneck, not CPU |
| Voice queue retries: 8 attempts, up to 2 minutes apart (staging already) | 3 attempts in 40 s gave up while instances could not start |
| Alerts "Cloud Run could not start an instance" and "Voice queue is not draining" in production (`scripts/setup_alerts.py production --apply`) | so quota exhaustion is seen in minutes |
| Do not run load tests between 05:30 and 06:00 IST | nightly jobs |
| **Deploy services one at a time, with a few minutes between them** | a new revision starts beside the old one; deploying seven services back to back on staging used the whole quota and the last revision could not start (4 Oct, retried successfully two minutes later; production showed no errors) |

## Long-term: separate projects

Staging should be its own Google Cloud project. Today it shares with production: the CPU quota (a test can starve production), the login pool (so staging has no logins and real sign-in cannot be tested there), the container registry, alert channels and budget. A separate project removes all five.

## Other limits met at 15,000 students (already handled on staging)

| Limit | Effect | State |
|---|---|---|
| API ends any request after 30 seconds | the nightly Lot job, as one request, was cut off | job now runs in batches of 1,000 (migration 76) |
| Database lock table | bulk insert of recordings in one statement failed | only the test loader; the product inserts one at a time |
| Run limited to 120 per student per hour | by design | working |
