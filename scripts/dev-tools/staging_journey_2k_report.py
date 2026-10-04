"""STAGING ONLY. Numbers and correctness for one stage of staging_journey_2k.py.

    python scripts/dev-tools/staging_journey_2k_report.py <stage> [--wait-voice SECONDS]

1. Requests: per kind and overall - count, rps, p50/p95/p99/max, 2xx/4xx/429/5xx/timeouts.
2. Cloud Run / Cloud SQL for the stage window (gcp_metrics.py).
3. Reconciliation of every student's chain in the database:
   student -> task (owner) -> submissions (owner, task, evaluator, expected verdict, no duplicate
   pass) -> recordings (owner, bound to that student's submission of that task, one authoritative)
   and every successful Submit / enqueue answer has its row (nothing lost).
Writes e2e-out/load2k/s<stage>-report.json and prints a summary.
"""
import glob, json, os, sys, time
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(__file__))
import st, gcp_metrics  # noqa: E402

OUT = os.path.join("e2e-out", "load2k")
stage = int(sys.argv[1])
wait_voice = int(sys.argv[sys.argv.index("--wait-voice") + 1]) if "--wait-voice" in sys.argv else 0
meta = json.load(open(os.path.join(OUT, f"s{stage}-run.json")))
plan = {p["n"]: p for p in json.load(open(os.path.join(OUT, f"s{stage}-plan.json")))}
reqs = [json.loads(l) for f in glob.glob(os.path.join(OUT, f"s{stage}-p*.jsonl")) for l in open(f, encoding="utf-8") if l.strip()]


def pct(xs, p):
    return round(xs[min(len(xs) - 1, int(len(xs) * p))]) if xs else None


def stats(rows, secs):
    lat = sorted(r["ms"] for r in rows)
    codes = Counter(str(r["code"]) for r in rows)
    return {"requests": len(rows), "rps": round(len(rows) / max(secs, 1), 1), "p50": pct(lat, .5), "p95": pct(lat, .95), "p99": pct(lat, .99),
            "max": lat[-1] if lat else None,
            "2xx": sum(v for k, v in codes.items() if k.startswith("2")),
            "4xx": sum(v for k, v in codes.items() if k.startswith("4") and k != "429"),
            "429": codes.get("429", 0), "5xx": sum(v for k, v in codes.items() if k.startswith("5")),
            "timeouts": codes.get("timeout", 0), "other": sum(v for k, v in codes.items() if not k[:1].isdigit() and k != "timeout"),
            "codes": dict(codes)}


secs = meta["end"] - meta["start"]
# Steady window: after the 60 s ramp-in.
steady = [r for r in reqs if r["t"] >= meta["start"] + 60]
by_kind = defaultdict(list)
for r in reqs:
    by_kind[r["kind"]].append(r)
report = {"stage": stage, "users": meta["users"], "seconds": round(secs), "aborted": meta["aborted"], "production_harm": meta["production_harm"],
          "vcpu_samples": meta.get("vcpu_samples"), "all": stats(reqs, secs), "steady": stats(steady, secs - 60),
          "kinds": {k: stats(v, secs) for k, v in sorted(by_kind.items())}}
READS = ("floor", "task_open", "buildlog", "squad", "profile", "voice_poll")
report["reads"] = stats([r for r in reqs if r["kind"] in READS], secs)
try:
    report["metrics"] = gcp_metrics.window(meta["start"], meta["end"] + 120)
except Exception as e:
    report["metrics"] = {"error": str(e)}

# ---- reconciliation ------------------------------------------------------------------
def svc(path):
    out, off = [], 0
    while True:
        c, b = st.http(f"{st.API}/{path}&limit=1000&offset={off}", headers={"Authorization": f"Bearer {st.token('svc')}"})
        assert c == 200, (c, str(b)[:200])
        out += b
        if len(b) < 1000:
            return out
        off += 1000


def sid(n):
    return f"10ad0000-0000-4000-8000-{n:012d}"


if wait_voice:
    t0 = time.time()
    while time.time() - t0 < wait_voice:
        v = svc(f"voice_explanations?select=status,transcription_status&task_id=in.({','.join(p['task'] for p in plan.values())})") if len(plan) <= 300 else \
            svc(f"voice_explanations?select=status,transcription_status,tasks!inner(title)&tasks.title=like.LOAD2K%20s{stage}%20*")
        open_ = [x for x in v if x["status"] not in ("scored", "failed")]
        print(f"  voice: {len(v)} recordings, {len(open_)} still processing", flush=True)
        if not open_:
            break
        time.sleep(30)

tasks = svc(f"tasks?select=id,student_id,title,status,sandbox_config_id,rubric_config_id&title=like.LOAD2K%20s{stage}%20*")
subs = svc(f"task_submissions?select=id,task_id,student_id,status,sandbox_score,sandbox_config_id,rubric_config_id,runner,created_at,tasks!inner(title)&tasks.title=like.LOAD2K%20s{stage}%20*")
voices = svc(f"voice_explanations?select=id,student_id,task_id,submission_id,status,transcription_status,current_authoritative,communication_score,evaluation,created_at,scoring_claimed_at,attempt_no,tasks!inner(title)&tasks.title=like.LOAD2K%20s{stage}%20*")
tasks_by_id = {t["id"]: t for t in tasks}
subs_by_id = {s["id"]: s for s in subs}
problems = defaultdict(list)
for t in tasks:
    n = int(t["title"].rsplit("#", 1)[1])
    if t["student_id"] != sid(n):
        problems["task owned by the wrong student"].append(t["id"])
subs_per_task = defaultdict(list)
for s in subs:
    t = tasks_by_id.get(s["task_id"])
    subs_per_task[s["task_id"]].append(s)
    if not t or s["student_id"] != t["student_id"]:
        problems["submission owner differs from task owner"].append(s["id"])
    if t and bool(t["sandbox_config_id"]) != bool(s["sandbox_config_id"]):
        problems["wrong evaluator type for the task"].append(s["id"])
    if t and t["sandbox_config_id"] and s["runner"] != "prooflab":
        problems["coding graded somewhere other than ProofLab's runner"].append(s["id"])
for tid, ss in subs_per_task.items():
    if sum(1 for s in ss if s["status"] == "passed") > 1:
        problems["more than one passed submission for one task"].append(tid)
verdicts = Counter()
for n, p in plan.items():
    ss = subs_per_task.get(p["task"], [])
    if not ss:
        continue
    final = sorted(ss, key=lambda s: s["created_at"])[-1]
    if p["kind"] == "code":
        ok = (final["status"] == "passed" and final["sandbox_score"] == 100) if p["expect"] == "passed" else final["status"] != "passed"
    else:
        ok = (final["status"] != "passed" and (final["sandbox_score"] or 0) <= 40) if p["expect"] == "not_passed" else (final["sandbox_score"] or 0) >= 70
    verdicts[(p["kind"], p["expect"], "as expected" if ok else "WRONG")] += 1
    if not ok:
        problems["score not what the submitted work deserves"].append((n, p["kind"], p["expect"], final["status"], final["sandbox_score"]))
auth = Counter()
for v in voices:
    s = subs_by_id.get(v["submission_id"])
    if not s:
        problems["recording not bound to a submission of this stage"].append(v["id"])
    elif s["student_id"] != v["student_id"] or s["task_id"] != v["task_id"]:
        problems["recording bound to another student's or task's submission"].append(v["id"])
    if v["current_authoritative"]:
        auth[v["submission_id"]] += 1
    if v["status"] == "scored" and v["communication_score"] is None:
        problems["scored recording without a score"].append(v["id"])
    if v["status"] == "failed" and v["communication_score"] is not None:
        problems["failed recording carrying a score"].append(v["id"])
for sub_id, k in auth.items():
    if k > 1:
        problems["more than one authoritative recording for a submission"].append(sub_id)
# Nothing lost: every 200 from Submit / enqueue has its row.
ok_submit = Counter(r["n"] for r in reqs if r["kind"] in ("submit_code", "submit_written") and r["code"] == 200)
ok_enqueue = Counter(r["n"] for r in reqs if r["kind"] == "voice_enqueue" and r["code"] == 200)
subs_by_student = Counter(int(tasks_by_id[s["task_id"]]["title"].rsplit("#", 1)[1]) for s in subs if s["task_id"] in tasks_by_id)
voice_by_student = Counter(int(tasks_by_id[v["task_id"]]["title"].rsplit("#", 1)[1]) for v in voices if v["task_id"] in tasks_by_id)
for n, k in ok_submit.items():
    if subs_by_student[n] < k:
        problems["accepted Submit with no stored submission (lost)"].append(n)
for n, k in ok_enqueue.items():
    if voice_by_student[n] < k:
        problems["accepted recording with no stored row (lost)"].append(n)
vs = Counter(v["status"] for v in voices)
# No finish time is stored; scoring_claimed_at (scoring starts, a few seconds before the result) is used.
ts = lambda x: time.mktime(time.strptime(x[:19], "%Y-%m-%dT%H:%M:%S"))
lat = sorted(ts(v["scoring_claimed_at"]) - ts(v["created_at"]) for v in voices if v["status"] == "scored" and v.get("scoring_claimed_at"))
report["correctness"] = {
    "tasks": len(tasks), "submissions": len(subs), "recordings": len(voices), "recording_states": dict(vs),
    "verdicts": {" / ".join(k): v for k, v in verdicts.items()},
    "voice_end_to_end_seconds": {"p50": pct(lat, .5), "p95": pct(lat, .95), "max": lat[-1] if lat else None},
    "problems": {k: v[:20] for k, v in problems.items()}, "problem_counts": {k: len(v) for k, v in problems.items()},
}
json.dump(report, open(os.path.join(OUT, f"s{stage}-report.json"), "w"), indent=1, default=str)
a, rd = report["steady"], report["reads"]
print(f"stage {stage}: {meta['users']} students, {report['seconds']}s, aborted={meta['aborted']}, production harm={len(meta['production_harm'])}")
print(f"  all requests: {report['all']['requests']} ({report['all']['rps']}/s) p50={report['all']['p50']} p95={report['all']['p95']} p99={report['all']['p99']} max={report['all']['max']} "
      f"4xx={report['all']['4xx']} 429={report['all']['429']} 5xx={report['all']['5xx']} timeouts={report['all']['timeouts']} other={report['all']['other']}")
for k, v in report["kinds"].items():
    print(f"  {k:15} n={v['requests']:6} p50={v['p50']} p95={v['p95']} p99={v['p99']} max={v['max']} 429={v['429']} 5xx={v['5xx']} to={v['timeouts']} codes={v['codes']}")
m = report["metrics"]
if "services" in m:
    print("  peak instances/CPU:", {k.replace('prooflab-', ''): (v.get('instances_peak'), v.get('cpu_p99_peak'), v.get('429', 0), v.get('5xx', 0)) for k, v in m["services"].items()})
    print("  vCPU held at peak: staging", m["vcpu_peak_staging_sum"], "production", m["vcpu_peak_production_sum"], "| SQL", m["sql"])
print("  correctness:", json.dumps({k: report["correctness"][k] for k in ("tasks", "submissions", "recordings", "recording_states", "verdicts", "voice_end_to_end_seconds", "problem_counts")}))
