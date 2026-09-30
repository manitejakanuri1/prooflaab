# Disaster recovery and rollback runbook (1 Oct 2026)

Plain steps for when something breaks. Every command has no secret in it; tokens are read at run time
and never printed. "Proven" means the step was run for real on 30 Sep / 1 Oct 2026 and timed.

Project `prooflab-508214`, region `asia-south1`. Run from Git Bash with `gcloud` signed in as the owner.

## Recovery targets

| What | Recovery point (data you can lose) | Recovery time | Proven? |
|---|---|---|---|
| Website (frontend) | none (every build is kept) | under 1 minute | yes, both directions, on live |
| A Cloud Run service (functions, api, files, ...) | none | about 15 seconds | yes, on staging (13 s back, 17 s forward) |
| Voice queue | none (tasks wait while paused) | seconds | yes, on staging |
| Reaper scheduler | none | seconds | yes, on staging |
| Private worker | none | seconds | yes, on staging |
| Database | up to a few minutes (point-in-time recovery, 7 days) or last daily backup | estimated 20-40 min for a clone (small database, 0.3 GB) | **NO — restore drill is owner command 2** |

## Who does what, in order

1. See the alert email (or a user report).
2. Check the site and `/ready`: `python scripts/healthcheck.py` (24 checks).
3. If a release just went out: roll back that one thing (sections below). Do not change anything else.
4. Re-run `python scripts/healthcheck.py` and `python scripts/dev-tools/attack_surface_check.py`.
5. Write down what happened in `docs/FINAL-RELEASE-GAPS.md` (or a new incident note).

## 1. Website rollback (proven on live)

List recent releases (newest first) and pick the version you want back:

```bash
TOK=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOK" -H "X-Goog-User-Project: prooflab-508214" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/prooflab-508214/channels/live/releases?pageSize=5" \
  | python -c "import json,sys;[print(r['releaseTime'],r['version']['name']) for r in json.load(sys.stdin)['releases']]"
```

Release a chosen version (replace VERSION with the full `sites/prooflab-508214/versions/...` name):

```bash
curl -s -X POST -H "Authorization: Bearer $TOK" -H "X-Goog-User-Project: prooflab-508214" \
  -H "Content-Type: application/json" -d '{"message":"rollback"}' \
  "https://firebasehosting.googleapis.com/v1beta1/sites/prooflab-508214/channels/live/releases?versionName=VERSION"
```

Or in the Firebase console: Hosting -> Release history -> the good version -> "Rollback".

Check: `curl -s https://prooflab.co.in | grep -o 'assets/index-[^"]*\.js'` shows the expected bundle.
Good version on 1 Oct 2026: `79a3164cfe001a3b` (bundle `index-CWe_5Kb3.js`).

Note: the next push to `main` redeploys whatever `main` holds. After a rollback, fix or revert `main` too.

## 2. Cloud Run service rollback (proven on staging)

```bash
SVC=prooflab-functions        # or prooflab-api, prooflab-files, prooflab-auth-bridge, ...
gcloud run revisions list --service $SVC --region asia-south1 --limit 5
gcloud run services update-traffic $SVC --region asia-south1 --to-revisions=GOOD-REVISION=100
```

Check: `curl -s https://prooflab-functions-135298577404.asia-south1.run.app/ready` shows `"loaded":40`.
Go forward again: `--to-latest`.

Known-good revisions on 1 Oct 2026: functions `00052-g84`, api `00003-n6c`, auth-bridge `00011-njh`,
files `00013-jsz`, accounts `00002-bc9`, transcriber `00002-8lk`, code-runner `00001-rpr`, worker `00001-sl6`.

## 3. Voice queue: pause and resume (proven on staging)

```bash
gcloud tasks queues pause  prooflab-transcription --location asia-south1
gcloud tasks queues resume prooflab-transcription --location asia-south1
```

While paused, new recordings wait in the queue; nothing is lost. The reaper re-queues anything stuck.

## 4. Reaper scheduler: pause and resume (proven on staging)

```bash
gcloud scheduler jobs pause  prooflab-transcription-reap --location asia-south1
gcloud scheduler jobs resume prooflab-transcription-reap --location asia-south1
```

## 5. Private worker: cut off and restore (proven on staging)

```bash
gcloud run services update prooflab-transcription-worker --region asia-south1 --ingress internal
gcloud run services update prooflab-transcription-worker --region asia-south1 --ingress all
```

(`all` is still private: only `prooflab-tasks-invoker` may call it.)

## 6. Database restore (NOT yet proven)

Backups: automated daily (window from 20:00 UTC, 7 kept) plus on-demand backups before each migration;
point-in-time recovery with 7 days of logs. Deletion protection is on.

Never restore over `prooflab-db` directly. Restore to a new instance, check it, then decide:

```bash
# a) clone to a moment before the damage (UTC)
gcloud sql instances clone prooflab-db prooflab-restore --point-in-time=2026-10-01T10:00:00Z
# b) check it (owner command 2 in docs/closure/OWNER-COMMANDS.md has the full check job)
# c) switch production to it: update the prooflab-db-uri secret to the new instance name,
#    then redeploy prooflab-api, prooflab-functions, prooflab-accounts (new revision reads the secret)
```

Before step c, stop writes: pause the queue (section 3) and the scheduler jobs. Step c has never been
run; the owner must approve it at the time.

To undo a single bad migration instead: restore the on-demand backup taken just before it into a
clone, compare, and write a forward fix migration.

## 7. AI provider (DeepSeek) down

- Only one provider is configured (DeepSeek). No automatic switch.
- Written grading answers "busy" (503); the student sees a retry message; nothing is lost.
- Voice scoring fails; the reaper retries unscored transcripts every minute until DeepSeek returns.
- Alert: "[P1] AI provider failing".
- Action: wait, check the DeepSeek status page and account balance. No rollback needed.

## 8. Cost runaway

Budget Rs 3,000 with alerts at 50 / 80 / 100 %. Fast brakes: pause the bug finder and crawler schedulers
(`for j in prooflab-bugfinder-run prooflab-bugfinder-deep-run prooflab-crawler-weekly; do gcloud scheduler jobs pause $j --location asia-south1; done`),
lower max instances (`gcloud run services update SVC --region asia-south1 --max-instances 1`).

## Incident log

- 30 Sep 2026: during a rollback drill, an interrupted command still ran and live served the previous
  build (`32c0c91d68670ab4`, `index-DxO87fXt.js`) twice: 21:25:33-21:26:39 and 21:27:48-21:28:23 UTC
  (about 1 min 40 s in total). The previous build is the Step 6 release itself, so students saw a
  working site either way. Found from the release list,
  fixed by releasing `79a3164cfe001a3b` again, checked with 5 reads and the headers. Lesson: after an
  interrupted command, read the live release list before doing anything else.
