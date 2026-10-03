"""Critical alerts for the things the stabilization work made visible in logs (G5).

    python scripts/setup_alerts.py staging              # print what would be created (no change)
    python scripts/setup_alerts.py staging --apply      # create the staging alerts (safe to re-run)
    python scripts/setup_alerts.py production --apply   # PRODUCTION: only with the owner's yes

A production system cannot rely on someone reading logs. Each alert below watches one exact
log line or metric, names what it means in plain words, and says what to do. Alerts are
created by display name, so re-running never duplicates. They notify the existing e-mail
channel "ProofLab alerts (...)" (scripts/setup_monitoring.py creates it).

P1 = act now. P2 = look today. Log-based alerts are limited to one notification an hour.
"""
import json, subprocess, sys, urllib.error, urllib.request

P = "prooflab-508214"
BASE = f"https://monitoring.googleapis.com/v3/projects/{P}"
LOGGING = f"https://logging.googleapis.com/v2/projects/{P}"
ENV = sys.argv[1] if len(sys.argv) > 1 else "staging"
APPLY = "--apply" in sys.argv
assert ENV in ("staging", "production")
PREFIX = "prooflab-staging-" if ENV == "staging" else "prooflab-"
TAG = "[STAGING]" if ENV == "staging" else ""
QUEUE = "prooflab-staging-transcription" if ENV == "staging" else "prooflab-transcription"

svc = lambda name: f'resource.type="cloud_run_revision" resource.labels.service_name="{PREFIX}{name}"'
# Functions log JSON, the Python services log text: match either.
line = lambda text: f'(jsonPayload.message:"{text}" OR textPayload:"{text}")'
ANY_SERVICE = ('resource.type="cloud_run_revision" resource.labels.service_name:"prooflab-staging-"' if ENV == "staging"
               else 'resource.type="cloud_run_revision" resource.labels.service_name:"prooflab-" NOT resource.labels.service_name:"staging"')

LOG_ALERTS = [
    ("P1", "Daily Lots failed for most students", f'{svc("functions")} {line("JOB FAILED: daily-lots")}',
     "The 05:40 job could not create today's Lot for 5% or more of students (or 50 or more). Scheduler retries it. Read the log line: it carries the first error and one student id. Fix the cause, then run the job again - it only creates what is missing."),
    ("P2", "Daily Lots failed for some students", f'{svc("functions")} {line("JOB SANITY: daily-lots could not create")}',
     "A few students did not get today's Lot (everyone else did). The line names one student and the database error. Usually one profile with unusual data."),
    ("P1", "Daily Lots created nothing", f'{svc("functions")} {line("JOB SANITY: daily-lots ran but")}',
     "The job ran and no Lot exists for today though students are active. Check that Lots have been written (Admin > Operations > Jobs & health)."),
    ("P2", "AI usage is not being recorded", f'{svc("functions")} {line("TELEMETRY PROBLEM")}',
     "Usage logging, the rate limiter, the AI cache or security events could not be written. AI still works but spend and abuse limits are blind. This is how usage logging silently stopped for three weeks in September."),
    ("P1", "Account sync stopped itself", f'{svc("accounts")} {line("ACCOUNT SYNC ABORTED")}',
     "The login/roster sync saw an abnormal number of missing logins and did nothing. Nobody was suspended. Check Identity Platform before the next run."),
    ("P2", "Account sync needs a person", f'{svc("accounts")} {line("ACCOUNT SYNC NEEDS REVIEW")}',
     "More students than the per-run limit would have been suspended. Review the list in Admin before anything happens to them."),
    ("P1", "Recordings failed for good", f'{svc("functions")} {line("TRANSCRIPTION-REAP ALERT")}',
     "Recordings ran out of automatic recovery attempts, or failed AI scoring for good. Those students see 'record again'. Check the transcriber and the queue."),
    ("P1", "Cloud Run could not start an instance", f'{ANY_SERVICE} (textPayload:"exceeded its quota limit" OR textPayload:"no available instance")',
     "A service could not get an instance: the project's CPU quota (shared by staging and production) or its own maximum is exhausted. Requests fail with 429/503 while this lasts. See docs/CLOUD-CAPACITY-PLAN.md."),
    ("P1", "Sign-in tokens cannot be issued or checked", f'{svc("auth-bridge")} severity>=ERROR',
     "The login bridge is failing: students cannot sign in, and services cannot get their database tokens. Check the bridge's logs and the signing key secret."),
    ("P2", "A service could not verify who is calling", f'{svc("functions")} ({line("SUSPENSION CHECK PROBLEM")} OR {line("the signer refused a service token")} OR {line("could not get this service")})',
     "The functions service could not get its token from the bridge, or could not check whether an account is suspended. Database calls may be failing."),
    ("P2", "The crawler found nothing new, repeatedly", f'resource.type="cloud_run_job" resource.labels.job_name="{PREFIX}crawler" {line("CRAWLER ZERO NEW")}',
     "The crawler has run several times in a row without one new page. Lots will start repeating. Check the approved sources."),
    ("P1", "A scheduled job keeps failing", f'resource.type="cloud_scheduler_job" resource.labels.job_id:"{"prooflab-staging-" if ENV == "staging" else "prooflab-"}" severity>=ERROR',
     "Cloud Scheduler reports a job failing (its retries included). Find which job in the log entry, then that service's logs."),
]

# Metric alerts: (priority, title, filter, threshold, window seconds, what to do)
METRIC_ALERTS = [
    ("P2", "AI calls are timing out", "llm_timeout", f'{svc("functions")} {line("LLM TIMEOUT")}', 5, 600,
     "More than 5 AI calls in 10 minutes got no answer within 90 seconds. Grading and voice scoring are slow or failing. Check the AI provider's status."),
    ("P2", "Code runner is failing or busy", None,
     f'metric.type="run.googleapis.com/request_count" resource.type="cloud_run_revision" resource.label.service_name="{PREFIX}code-runner" metric.label.response_code_class=one_of("5xx","4xx") metric.label.response_code!="401"',
     20, 300, "The code runner answered more than 20 errors (5xx or 429 busy) in 5 minutes. Students' Run and Submit fail. Check its instances and maximum."),
    ("P2", "Voice queue is not draining", None,
     f'metric.type="cloudtasks.googleapis.com/queue/depth" resource.type="cloud_tasks_queue" resource.label.queue_id="{QUEUE}"',
     50, 900, "More than 50 recordings have been waiting for 15 minutes. The transcriber cannot keep up or cannot start. Students see 'Queued'."),
]


def api(method, url, body=None):
    token = subprocess.run("gcloud auth print-access-token", shell=True, capture_output=True, text=True).stdout.strip()
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {url.split('?')[0]} -> {e.code} {e.read().decode()[:300]}")


def listing(url, key):
    out, page = [], ""
    while True:
        d = api("GET", url + (("&" if "?" in url else "?") + f"pageToken={page}" if page else ""))
        out += d.get(key, [])
        page = d.get("nextPageToken", "")
        if not page:
            return out


def name(prio, title):
    return f"{TAG}[{prio}] {title}"


wanted = []
for prio, title, flt, doc in LOG_ALERTS:
    wanted.append({"displayName": name(prio, title), "combiner": "OR", "enabled": True,
                   "conditions": [{"displayName": title, "conditionMatchedLog": {"filter": flt}}],
                   "alertStrategy": {"notificationRateLimit": {"period": "3600s"}},
                   "documentation": {"content": doc, "mimeType": "text/markdown"}})
log_metrics = []
for prio, title, metric, flt, limit, window, doc in METRIC_ALERTS:
    if metric:
        metric_name = f"{metric}_{ENV}"
        log_metrics.append((metric_name, flt))
        flt = f'metric.type="logging.googleapis.com/user/{metric_name}" resource.type="cloud_run_revision"'
    aligner = "ALIGN_MAX" if "queue/depth" in flt else "ALIGN_SUM" if metric else "ALIGN_RATE" if False else "ALIGN_SUM"
    wanted.append({"displayName": name(prio, title), "combiner": "OR", "enabled": True,
                   "conditions": [{"displayName": title, "conditionThreshold": {
                       "filter": flt, "comparison": "COMPARISON_GT", "thresholdValue": limit, "duration": "0s",
                       "aggregations": [{"alignmentPeriod": f"{window}s", "perSeriesAligner": aligner,
                                         "crossSeriesReducer": "REDUCE_MAX" if aligner == "ALIGN_MAX" else "REDUCE_SUM"}]}}],
                   "documentation": {"content": doc, "mimeType": "text/markdown"}})

print(f"{ENV}: {len(wanted)} alerts ({len(LOG_ALERTS)} on log lines, {len(METRIC_ALERTS)} on metrics)")
for w in wanted:
    c = w["conditions"][0]
    print(" ", w["displayName"], "<-", (c.get("conditionMatchedLog") or c["conditionThreshold"])["filter"][:110])
if not APPLY:
    print("\nnothing changed (add --apply to create them)")
    sys.exit(0)

channels = [c for c in listing(f"{BASE}/notificationChannels", "notificationChannels") if c.get("displayName", "").startswith("ProofLab alerts")]
if not channels:
    raise SystemExit("no 'ProofLab alerts (...)' e-mail channel: run scripts/setup_monitoring.py first")
have_metrics = {m["name"] for m in listing(f"{LOGGING}/metrics", "metrics")}
for metric_name, flt in log_metrics:
    if metric_name not in have_metrics:
        api("POST", f"{LOGGING}/metrics", {"name": metric_name, "filter": flt, "description": "created by scripts/setup_alerts.py"})
        print("created log metric", metric_name)
have = {p["displayName"] for p in listing(f"{BASE}/alertPolicies", "alertPolicies")}
made = 0
for w in wanted:
    if w["displayName"] in have:
        continue
    w["notificationChannels"] = [channels[0]["name"]]
    api("POST", f"{BASE}/alertPolicies", w)
    made += 1
    print("created", w["displayName"])
print(f"done: {made} created, {len(wanted) - made} already there; notifying {channels[0]['displayName']}")
