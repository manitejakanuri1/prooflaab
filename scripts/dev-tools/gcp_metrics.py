"""Read-only Cloud Monitoring numbers for a time window (staging load tests and the production watch).

    python scripts/dev-tools/gcp_metrics.py <start-epoch> <end-epoch>

Prints, per Cloud Run service (staging and production): peak instances, peak CPU (p99 of
instance CPU), requests by class (2xx/4xx/5xx) and 429s; for each Cloud SQL instance: peak CPU,
peak memory, peak connections. Also an estimate of the vCPU held at peak (instances x vCPU).
"""
import json, os, subprocess, sys, time, urllib.parse, urllib.request

P = "prooflab-508214"
_tok = {"v": "", "at": 0}


def token():
    if time.time() - _tok["at"] > 1500:
        _tok["v"] = subprocess.run("gcloud auth print-access-token", shell=True, capture_output=True, text=True).stdout.strip()
        _tok["at"] = time.time()
    return _tok["v"]


def series(flt, start, end, aligner, reducer=None, group=(), period=60):
    q = {"filter": flt, "interval.startTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
         "interval.endTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end)),
         "aggregation.alignmentPeriod": f"{period}s", "aggregation.perSeriesAligner": aligner}
    if reducer:
        q["aggregation.crossSeriesReducer"] = reducer
        q["aggregation.groupByFields"] = list(group)
    out, page = [], None
    while True:
        if page:
            q["pageToken"] = page
        url = f"https://monitoring.googleapis.com/v3/projects/{P}/timeSeries?" + urllib.parse.urlencode(q, doseq=True)
        d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}"}), timeout=60).read())
        out += d.get("timeSeries", [])
        page = d.get("nextPageToken")
        if not page:
            return out


def val(p):
    v = p["value"]
    return float(v.get("doubleValue", v.get("int64Value", 0)))


def window(start, end):
    res = {}
    svc_cpu = {}
    for env in ("staging", "production"):
        snap = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "infra", env, "services.json")))
        for k, v in snap.items():
            c = str(v.get("cpu") or "1")
            svc_cpu[k] = float(c[:-1]) / 1000 if c.endswith("m") else float(c)
    run = 'resource.type="cloud_run_revision"'
    for ts in series(f'metric.type="run.googleapis.com/container/instance_count" AND {run}', start, end, "ALIGN_MAX",
                     "REDUCE_SUM", ["resource.labels.service_name"]):
        s = ts["resource"]["labels"]["service_name"]
        res.setdefault(s, {})["instances_peak"] = max(val(p) for p in ts["points"])
    for ts in series(f'metric.type="run.googleapis.com/container/cpu/utilizations" AND {run}', start, end, "ALIGN_PERCENTILE_99",
                     "REDUCE_MAX", ["resource.labels.service_name"]):
        s = ts["resource"]["labels"]["service_name"]
        res.setdefault(s, {})["cpu_p99_peak"] = round(max(val(p) for p in ts["points"]), 2)
    for ts in series(f'metric.type="run.googleapis.com/request_count" AND {run}', start, end, "ALIGN_DELTA",
                     "REDUCE_SUM", ["resource.labels.service_name", "metric.labels.response_code"]):
        s = ts["resource"]["labels"]["service_name"]
        code = ts["metric"]["labels"].get("response_code", "?")
        n = sum(val(p) for p in ts["points"])
        r = res.setdefault(s, {})
        cls = "429" if code == "429" else code[0] + "xx"
        r[cls] = int(r.get(cls, 0) + n)
    for s, r in res.items():
        if "instances_peak" in r:
            r["vcpu_peak"] = round(r["instances_peak"] * svc_cpu.get(s, 1), 1)
    sql = {}
    for metric, key in (("cloudsql.googleapis.com/database/cpu/utilization", "cpu_peak"),
                        ("cloudsql.googleapis.com/database/memory/utilization", "mem_peak"),
                        ("cloudsql.googleapis.com/database/postgresql/num_backends", "connections_peak")):
        for ts in series(f'metric.type="{metric}"', start, end, "ALIGN_MAX", "REDUCE_SUM" if "backends" in metric else "REDUCE_MAX",
                         ["resource.labels.database_id"]):
            db = ts["resource"]["labels"]["database_id"].split(":")[-1]
            sql.setdefault(db, {})[key] = round(max(val(p) for p in ts["points"]), 2)
    tot = lambda pred: round(sum(r.get("vcpu_peak", 0) for s, r in res.items() if pred(s)), 1)
    return {"services": res, "sql": sql,
            "vcpu_peak_staging_sum": tot(lambda s: "staging" in s),
            "vcpu_peak_production_sum": tot(lambda s: "staging" not in s)}


if __name__ == "__main__":
    print(json.dumps(window(float(sys.argv[1]), float(sys.argv[2])), indent=1))
