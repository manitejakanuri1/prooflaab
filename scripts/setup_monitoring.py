"""Creates ProofLab's uptime checks and alert policies in Google Cloud Monitoring. Safe to re-run: anything
that already exists (same display name) is skipped. Uses your gcloud login; nothing secret is written.

usage: python scripts/setup_monitoring.py [alert-email]      (default: the active gcloud account)

P1 = wake someone up (site down, database, jobs, AI). P2 = look at it today (slow, busy, near limits).
Thresholds are starting points: tune them after two weeks of real traffic.
"""
import json, subprocess, sys, urllib.request, urllib.error

P = "prooflab-508214"
BASE = f"https://monitoring.googleapis.com/v3/projects/{P}"
TOKEN = subprocess.run("gcloud auth print-access-token", shell=True, capture_output=True, text=True).stdout.strip()
EMAIL = sys.argv[1] if len(sys.argv) > 1 else subprocess.run("gcloud config get-value account", shell=True, capture_output=True, text=True).stdout.strip()


def api(method, url, body=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None,
                                 {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {url.split('/v3/')[-1]} -> {e.code}: {e.read().decode()[:400]}")


def existing(kind, key="displayName"):
    out, token = {}, ""
    while True:
        d = api("GET", f"{BASE}/{kind}" + (f"?pageToken={token}" if token else ""))
        for x in d.get(kind, []):
            out[x[key]] = x
        token = d.get("nextPageToken", "")
        if not token:
            return out


# ---------------------------------------------------------------- who is told
channels = existing("notificationChannels")
name = f"ProofLab alerts ({EMAIL})"
if name not in channels:
    channels[name] = api("POST", f"{BASE}/notificationChannels",
                         {"type": "email", "displayName": name, "labels": {"email_address": EMAIL}, "enabled": True})
    print("created channel", name)
CH = channels[name]["name"]
print("channel", name, "| verification:", channels[name].get("verificationStatus", "?"))

# ---------------------------------------------------------------- uptime checks
UPTIME = [
    ("ProofLab site", "prooflab.co.in", "/", None, None),
    ("ProofLab functions ready (all 38 loaded)", "prooflab-functions-ysn2mpe6sa-el.a.run.app", "/ready", '"ok":true', None),
    ("ProofLab API (PostgREST)", "prooflab-api-ysn2mpe6sa-el.a.run.app", "/", None, None),
    ("ProofLab voice service ready", "prooflab-transcriber-ysn2mpe6sa-el.a.run.app", "/ready", None, None),
    ("ProofLab accounts service ready", "prooflab-accounts-ysn2mpe6sa-el.a.run.app", "/ready", None, None),
    ("ProofLab code runner ready", "prooflab-code-runner-ysn2mpe6sa-el.a.run.app", "/ready", None, None),
    # These two run an older image with no /ready route: an unknown path answers 404 with this body.
    # A dead container gives a different failure (timeout/503), so 404-with-this-body still proves it is up.
    # Google's own edge intercepts /healthz on a bare Cloud Run URL and returns ITS OWN 404 page
    # before the request ever reaches the container (confirmed: identical on old and new images,
    # so it is not our code). "/" is not reserved and reliably returns our app's own 404 JSON, which
    # proves the container answered (a dead container times out or gives a different error).
    ("ProofLab login bridge answering", "prooflab-auth-bridge-ysn2mpe6sa-el.a.run.app", "/", '"error":"not found"', "4xx"),
    ("ProofLab files service answering", "prooflab-files-ysn2mpe6sa-el.a.run.app", "/", '"error":"not found"', "4xx"),
]
checks = existing("uptimeCheckConfigs")
check_ids = {}
for dn, host, path, match, status_class in UPTIME:
    body = {
        "displayName": dn,
        "monitoredResource": {"type": "uptime_url", "labels": {"project_id": P, "host": host}},
        "httpCheck": {"path": path, "port": 443, "useSsl": True, "validateSsl": True, "requestMethod": "GET",
                      "acceptedResponseStatusCodes": [{"statusClass": f"STATUS_CLASS_{status_class or '2XX'}"}]},
        "period": "60s", "timeout": "10s",
    }
    if match:
        body["contentMatchers"] = [{"content": match, "matcher": "CONTAINS_STRING"}]
    if dn not in checks:
        checks[dn] = api("POST", f"{BASE}/uptimeCheckConfigs", body)
        print("created uptime check", dn)
    elif checks[dn].get("httpCheck", {}).get("path") != path:
        checks[dn] = api("PATCH", f"https://monitoring.googleapis.com/v3/{checks[dn]['name']}?updateMask=httpCheck,period,timeout", {**body, "name": checks[dn]["name"]})
        print("updated uptime check", dn, "-> path", path)
    check_ids[dn] = checks[dn]["name"].split("/")[-1]


# ---------------------------------------------------------------- alert policies
def agg(period, aligner, reducer=None, group=None):
    a = {"alignmentPeriod": period, "perSeriesAligner": aligner}
    if reducer:
        a["crossSeriesReducer"] = reducer
        a["groupByFields"] = group or []
    return [a]


def threshold(label, flt, comparison, value, duration, aggregations):
    return {"displayName": label, "conditionThreshold": {"filter": flt, "comparison": comparison, "thresholdValue": value,
            "duration": duration, "aggregations": aggregations, "trigger": {"count": 1}}}


def log_match(label, flt):
    return {"displayName": label, "conditionMatchedLog": {"filter": flt}}


RUN = 'resource.type="cloud_run_revision"'
SQL = 'resource.type="cloudsql_database"'
SVC = "resource.label.service_name"
POLICIES = []


def policy(prio, title, condition, doc, log_based=False):
    p = {"displayName": f"[{prio}] {title}", "combiner": "OR", "conditions": [condition], "notificationChannels": [CH], "enabled": True,
         "documentation": {"content": doc, "mimeType": "text/markdown"}}
    if log_based:
        p["alertStrategy"] = {"notificationRateLimit": {"period": "3600s"}}
    POLICIES.append(p)


# uptime: any check failing from more than one place
for dn, cid in check_ids.items():
    policy("P1", f"Down: {dn}", threshold(
        f"{dn} failing", f'metric.type="monitoring.googleapis.com/uptime_check/check_passed" resource.type="uptime_url" metric.label.check_id="{cid}"',
        "COMPARISON_GT", 1, "60s", agg("1200s", "ALIGN_NEXT_OLDER", "REDUCE_COUNT_FALSE", ["resource.label.host"])),
        f"The uptime check **{dn}** is failing from more than one location. Open the site or `/ready` yourself; check Cloud Run logs for the service.")

# Cloud Run
policy("P1", "Server errors (5xx) on any service", threshold(
    "More than 10 5xx in 5 minutes", f'metric.type="run.googleapis.com/request_count" {RUN} metric.label.response_code_class="5xx"',
    "COMPARISON_GT", 10, "0s", agg("300s", "ALIGN_SUM", "REDUCE_SUM", [SVC])),
    "A Cloud Run service is returning 5xx errors. Open Error Reporting and Logs Explorer for that service; search `severity>=ERROR`.")
policy("P2", "Slow responses (95th percentile over 3 s)", threshold(
    "Slowest 5% over 3 s for 10 minutes",
    f'metric.type="run.googleapis.com/request_latencies" {RUN} {SVC}=one_of("prooflab-functions","prooflab-api","prooflab-auth-bridge","prooflab-files")',
    "COMPARISON_GT", 3000, "600s", agg("300s", "ALIGN_PERCENTILE_95", "REDUCE_MAX", [SVC])),
    "Responses are slow. Check Cloud SQL CPU and connections, then the slowest calls in the admin Student Trace page.")
policy("P2", "Voice or code service is busy (429/503)", threshold(
    "More than 20 busy answers in 5 minutes",
    f'metric.type="run.googleapis.com/request_count" {RUN} {SVC}=one_of("prooflab-transcriber","prooflab-code-runner") metric.label.response_code=one_of("429","503")',
    "COMPARISON_GT", 20, "0s", agg("300s", "ALIGN_SUM", "REDUCE_SUM", [SVC])),
    "Students are queuing for voice or code. Raise the maximum instances of the service if it keeps happening.")
policy("P1", "Voice or code service failing (5xx)", threshold(
    "More than 5 failures in 10 minutes",
    f'metric.type="run.googleapis.com/request_count" {RUN} {SVC}=one_of("prooflab-transcriber","prooflab-code-runner") metric.label.response_code_class="5xx"',
    "COMPARISON_GT", 5, "0s", agg("600s", "ALIGN_SUM", "REDUCE_SUM", [SVC])),
    "The voice or code service is failing, not just busy. Check its logs.")
policy("P2", "Login bridge rejecting many requests", threshold(
    "More than 50 4xx in 5 minutes",
    f'metric.type="run.googleapis.com/request_count" {RUN} {SVC}="prooflab-auth-bridge" metric.label.response_code_class="4xx"',
    "COMPARISON_GT", 50, "0s", agg("300s", "ALIGN_SUM", "REDUCE_SUM", [SVC])),
    "Many logins are being refused. Could be a bot, a Google login quota, or a broken deploy.")
policy("P2", "Container CPU over 85%", threshold(
    "CPU over 85% for 10 minutes",
    f'metric.type="run.googleapis.com/container/cpu/utilizations" {RUN} {SVC}=one_of("prooflab-functions","prooflab-api","prooflab-auth-bridge")',
    "COMPARISON_GT", 0.85, "600s", agg("60s", "ALIGN_PERCENTILE_99", "REDUCE_MAX", [SVC])),
    "A service is close to its CPU limit. It will add copies up to its maximum; if it hits the maximum, raise it.")
policy("P2", "Container memory over 85%", threshold(
    "Memory over 85% for 10 minutes",
    f'metric.type="run.googleapis.com/container/memory/utilizations" {RUN} {SVC}=one_of("prooflab-functions","prooflab-api","prooflab-auth-bridge")',
    "COMPARISON_GT", 0.85, "600s", agg("60s", "ALIGN_PERCENTILE_99", "REDUCE_MAX", [SVC])),
    "A service is close to its memory limit and may restart.")

# Cloud SQL
policy("P1", "Database is down", threshold("Database not up", f'metric.type="cloudsql.googleapis.com/database/up" {SQL}',
    "COMPARISON_LT", 1, "120s", agg("60s", "ALIGN_MEAN")), "The Cloud SQL database is not answering. Everything depends on it.")
policy("P1", "Database CPU over 80%", threshold("CPU over 80% for 10 minutes",
    f'metric.type="cloudsql.googleapis.com/database/cpu/utilization" {SQL}', "COMPARISON_GT", 0.8, "600s", agg("60s", "ALIGN_MEAN")),
    "Open Query Insights on the database to find the slow query. Consider a bigger tier.")
policy("P1", "Database disk over 80% full", threshold("Disk over 80%",
    f'metric.type="cloudsql.googleapis.com/database/disk/utilization" {SQL}', "COMPARISON_GT", 0.8, "300s", agg("300s", "ALIGN_MEAN")),
    "A full disk stops all writes. Raise the disk size (it only grows) or clear old data such as the 90-day step trail.")
policy("P1", "Database memory over 90%", threshold("Memory over 90% for 10 minutes",
    f'metric.type="cloudsql.googleapis.com/database/memory/utilization" {SQL}', "COMPARISON_GT", 0.9, "600s", agg("60s", "ALIGN_MEAN")),
    "The database is short of memory. Consider a bigger tier.")
policy("P1", "Database connections high (over 40)", threshold("More than 40 connections for 5 minutes",
    f'metric.type="cloudsql.googleapis.com/database/postgresql/num_backends" {SQL}', "COMPARISON_GT", 40, "300s", agg("60s", "ALIGN_MEAN")),
    "Too many database connections. Check the PostgREST pool and add a connection pooler. The limit depends on the tier.")

# log-based: our own events
policy("P1", "A scheduled job failed", log_match("Scheduler job error", 'resource.type="cloud_scheduler_job" severity>=ERROR'),
       "A Cloud Scheduler job failed (daily tasks, Sunday scoring, squads, weekly plan, prune, accounts sync, crawler). If tasks did not arrive, check `prooflab-daily-lots` first.", True)
policy("P2", "The weekly crawler failed", log_match("Crawler job error", 'resource.type="cloud_run_job" severity>=ERROR'),
       "The content crawler failed. New pages will not arrive for Lots. Check the job's last execution log.", True)
policy("P1", "AI provider failing", log_match("AI providers exhausted or failing",
       f'{RUN} resource.labels.service_name="prooflab-functions" severity>=ERROR jsonPayload.message:"LLM providers"'),
       "Every AI provider failed or rate-limited. Resume reading, grading and roadmaps will fail. Check the DeepSeek account balance and limits.", True)
policy("P1", "Daily tasks were not created", log_match("daily-lots made 0 tasks",
       f'{RUN} resource.labels.service_name="prooflab-functions" jsonPayload.message:"JOB SANITY: daily-lots"'),
       "The 05:40 IST job ran without error but created 0 tasks for today, though students were active recently. Check `assign_todays_lots` and `source_content` (does content exist to assign?).", True)
policy("P1", "Sunday scoring did not run", log_match("weekly-seasons scored 0 rows",
       f'{RUN} resource.labels.service_name="prooflab-functions" jsonPayload.message:"JOB SANITY: weekly-seasons"'),
       "The Sunday 23:30 IST job ran without error but wrote 0 `student_weekly_scores` rows, though seasons are active. Squad standings will be wrong for the week. Check `run_all_seasons`.", True)

policies = existing("alertPolicies")
made = 0
for p in POLICIES:
    if p["displayName"] in policies:
        continue
    api("POST", f"{BASE}/alertPolicies", p)
    made += 1
    print("created", p["displayName"])
print(f"done: {len(POLICIES)} policies wanted, {made} created, {len(POLICIES) - made} already there; {len(check_ids)} uptime checks")
