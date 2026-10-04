"""STAGING ONLY (never production). Real student journeys for the 2,000-student release test.

    python scripts/dev-tools/staging_journey_2k.py <stage> <users> [seconds]

Each virtual user is a different synthetic student (Load Student 1..2000) with its own
ticket, working on the task made for it for this stage (title 'LOAD2K s<stage> ...',
prepared by staging_journey_2k_prep.sql). One journey, with human think time:

  Floor (today's Lot, week, task list) -> open the task -> read 20-60 s
  coding:  write 40-120 s -> Run 1-3 times (20-50 s apart) -> Submit
  written: write 60-150 s -> Submit
  -> record voice: upload the recording, queue it -> look at the result every 10-20 s
  -> Build-log -> Squad -> Profile -> idle 20-60 s -> Floor again, and so on until time is up.

Students start spread over the first 60 s (nobody presses Submit in the same millisecond).
What each student submits is fixed by its number, so the result can be checked afterwards:
  coding:  every 10th student submits a hard-coded "print the example" program (must FAIL),
           the rest the config's reference solution (must PASS)
  written: every 10th student submits an off-topic answer (must not pass), the rest the
           config's reference answer.
Every request is written to e2e-out/load2k/s<stage>-requests.jsonl. While it runs, production
is watched every 30 s (5xx, 429, "no available instance"); any sign of harm, or the file
e2e-out/load2k/ABORT, stops every user at once.
"""
import asyncio, json, multiprocessing as mp, os, random, subprocess, sys, time, uuid

sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

FILES = "https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app"
OUT = os.path.join("e2e-out", "load2k")
ABORT = os.path.join(OUT, "ABORT")
WAV = os.path.join("e2e-out", "loadvoice.wav")
P = "prooflab-508214"


def sid(n):
    return f"10ad0000-0000-4000-8000-{n:012d}"


def svc_get(path):
    code, body = st.http(f"{st.API}/{path}", headers={"Authorization": f"Bearer {st.token('svc', ttl=900)}"})
    assert code == 200, (code, str(body)[:300])
    return body


def plan(stage, users):
    """The stage's tasks and what each student will submit."""
    tasks = svc_get(f"tasks?select=id,student_id,sandbox_config_id,rubric_config_id&title=like.LOAD2K%20s{stage}%20*&limit=5000")
    by_student = {t["student_id"]: t for t in tasks}
    cfg_ids = {t["sandbox_config_id"] for t in tasks if t["sandbox_config_id"]}
    rub_ids = {t["rubric_config_id"] for t in tasks if t["rubric_config_id"]}
    sand = {c["id"]: c for c in svc_get(f"task_sandbox_config?select=id,reference_solution,test_cases,language&id=in.({','.join(cfg_ids)})")} if cfg_ids else {}
    rub = {c["id"]: c for c in svc_get(f"task_rubric_config?select=id,reference_answer,min_words&id=in.({','.join(rub_ids)})")} if rub_ids else {}
    out = []
    for n in range(1, users + 1):
        t = by_student.get(sid(n))
        if not t:
            continue
        wrong = n % 10 == 0
        if t["sandbox_config_id"]:
            c = sand[t["sandbox_config_id"]]
            first = next(x for x in c["test_cases"] if x["visible"])["expected_output"]
            code = f"import sys\nsys.stdout.write({json.dumps(first)})" if wrong else c["reference_solution"]
            out.append({"n": n, "task": t["id"], "kind": "code", "code": code, "expect": "failed" if wrong else "passed"})
        else:
            c = rub[t["rubric_config_id"]]
            off = ("I like cricket and my favourite food is biryani. " * 40) if wrong else c["reference_answer"]
            out.append({"n": n, "task": t["id"], "kind": "written", "answer": off, "expect": "not_passed" if wrong else "graded"})
    return out


async def journey(client, job, stop, log, wav):
    import httpx
    s = sid(job["n"])
    tok = st.token(f"user:{s}", ttl=4 * 3600)
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    today = time.strftime("%Y-%m-%d")

    async def call(kind, method, url, body=None, headers=None, raw=None, timeout=90):
        t0 = time.time()
        code, text = None, ""
        try:
            r = await client.request(method, url, headers=headers or h, timeout=timeout,
                                     content=raw if raw is not None else (json.dumps(body) if body is not None else None))
            code, text = r.status_code, r.text
        except httpx.TimeoutException:
            code = "timeout"
        except Exception as e:  # connection reset and the like
            code = type(e).__name__
        log.write(json.dumps({"t": round(t0, 3), "ms": round((time.time() - t0) * 1000), "kind": kind, "code": code, "n": job["n"]}) + "\n")
        return code, text

    async def think(a, b):
        await asyncio.sleep(random.uniform(a, b))
        return time.time() < stop and not os.path.exists(ABORT)

    async def reads(kind, items):
        for method, path, body in items:
            await call(kind, method, f"{st.API}/{path}", body)
            await asyncio.sleep(random.uniform(0.3, 1.5))

    floor = [("POST", "rpc/my_todays_lot", {}), ("POST", "rpc/my_week", {}),
             ("GET", f"tasks?select=id,title,status,lot_date,sandbox_config_id,rubric_config_id&student_id=eq.{s}&order=created_at.desc&limit=50", None)]
    buildlog = [("GET", f"task_submissions?select=id,task_id,status,sandbox_score,passed_count,total_count,rubric_scores,created_at,tasks(title,lot_date)&student_id=eq.{s}&order=created_at.desc&limit=100", None),
                ("GET", f"voice_explanations?select=id,task_id,submission_id,current_authoritative,status,communication_score,evaluation,created_at&student_id=eq.{s}&order=created_at.desc&limit=100", None),
                ("POST", "rpc/my_rubric_labels", {})]
    squad = [("POST", "rpc/my_squad_members", {}), ("POST", "rpc/my_rank", {})]
    profile = [("GET", f"student_profiles?select=id,full_name,total_xp,college_id&id=eq.{s}", None), ("POST", "rpc/my_skills_proved", {})]

    await asyncio.sleep(random.uniform(0, 60))
    submitted = recorded = False
    voice_path = None
    while time.time() < stop and not os.path.exists(ABORT):
        await reads("floor", floor)
        if not submitted:
            view = "sandbox_task_view" if job["kind"] == "code" else "rubric_task_view"
            await call("task_open", "POST", f"{st.API}/rpc/{view}", {"_task_id": job["task"]})
            if not await think(20, 60): break
            if job["kind"] == "code":
                if not await think(40, 120): break
                for _ in range(random.randint(1, 3)):
                    await call("run", "POST", f"{st.FUNCTIONS}/run-sandbox", {"task_id": job["task"], "code": job["code"]})
                    if not await think(20, 50): break
                code, text = await call("submit_code", "POST", f"{st.FUNCTIONS}/submit-sandbox-task", {"task_id": job["task"], "code": job["code"]})
            else:
                if not await think(60, 150): break
                code, text = await call("submit_written", "POST", f"{st.FUNCTIONS}/submit-written-task", {"task_id": job["task"], "answer": job["answer"]})
            submitted = code in (200, 409)
            if not submitted:
                if not await think(20, 40): break
                continue
        if submitted and not recorded:
            if not await think(5, 20): break
            voice_path = f"{s}/{int(time.time() * 1000)}-explain.wav"
            code, _ = await call("voice_upload", "PUT", f"{FILES}/file/voice-explanations/{voice_path}", raw=wav,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "audio/wav"})
            if code == 200:
                code, _ = await call("voice_enqueue", "POST", f"{st.FUNCTIONS}/transcription-enqueue",
                                     {"storage_path": voice_path, "task_id": job["task"], "duration_seconds": 17,
                                      "idempotency_key": str(uuid.uuid4())})
            recorded = code == 200
        if recorded:
            for _ in range(3):  # the result screen looks again every 10-20 s
                await call("voice_poll", "GET", f"{st.API}/voice_explanations?select=id,status,transcription_status,communication_score&storage_path=eq.{voice_path}", None)
                if not await think(10, 20): break
        await reads("buildlog", buildlog)
        if not await think(5, 15): break
        await reads("squad", squad)
        await reads("profile", profile)
        if not await think(20, 60): break


def worker(jobs, stop, path):
    import httpx

    async def main():
        wav = open(WAV, "rb").read()
        limits = httpx.Limits(max_connections=len(jobs) + 50, max_keepalive_connections=len(jobs) + 50)
        async with httpx.AsyncClient(limits=limits, http2=False) as client:
            with open(path, "w", encoding="utf-8") as log:
                await asyncio.gather(*(journey(client, j, stop, log, wav) for j in jobs))
    asyncio.run(main())


def production_harm(since):
    """Production 5xx / 429 / could-not-start in the window. Any one is a stop."""
    f = (f'resource.type="cloud_run_revision" AND resource.labels.service_name:"prooflab-" '
         f'AND NOT resource.labels.service_name:"staging" AND timestamp>="{since}" AND '
         f'(httpRequest.status>=500 OR httpRequest.status=429 OR textPayload:"no available instance" '
         f'OR textPayload:"exceeded its quota" OR textPayload:"Quota exceeded")')
    r = subprocess.run(["gcloud", "logging", "read", f, f"--project={P}", "--limit=20", "--format=json"],
                       capture_output=True, text=True, shell=os.name == "nt")
    try:
        rows = json.loads(r.stdout or "[]")
    except ValueError:
        return []
    return [(x.get("timestamp"), x.get("resource", {}).get("labels", {}).get("service_name"),
             (x.get("httpRequest") or {}).get("status"), (x.get("textPayload") or "")[:120]) for x in rows]


if __name__ == "__main__":
    stage, users = int(sys.argv[1]), int(sys.argv[2])
    seconds = int(sys.argv[3]) if len(sys.argv) > 3 else 420
    os.makedirs(OUT, exist_ok=True)
    if os.path.exists(ABORT):
        os.remove(ABORT)
    jobs = plan(stage, users)
    print(f"stage {stage}: {len(jobs)} students with a task ({sum(j['kind'] == 'code' for j in jobs)} coding, "
          f"{sum(j['kind'] == 'written' for j in jobs)} written); {seconds}s", flush=True)
    json.dump([{k: v for k, v in j.items() if k in ('n', 'task', 'kind', 'expect')} for j in jobs],
              open(os.path.join(OUT, f"s{stage}-plan.json"), "w"))
    start = time.time()
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start))
    stop = start + seconds
    per = 500
    parts = [jobs[i:i + per] for i in range(0, len(jobs), per)]
    procs = [mp.Process(target=worker, args=(p, stop, os.path.join(OUT, f"s{stage}-p{i}.jsonl"))) for i, p in enumerate(parts)]
    for p in procs:
        p.start()
    harm, quota = [], []
    import gcp_metrics
    while any(p.is_alive() for p in procs):
        time.sleep(30)
        harm = production_harm(since)
        # The 20-vCPU quota is shared and is already ~full at rest (idle instances count), so
        # the stop signal is production's own symptoms above; vCPU held is recorded for the report.
        try:
            w = gcp_metrics.window(time.time() - 180, time.time())
            quota.append((int(time.time() - start), w["vcpu_peak_staging_sum"], w["vcpu_peak_production_sum"]))
        except Exception as e:
            print("  (metrics read failed:", type(e).__name__, ")", flush=True)
        if harm:
            open(ABORT, "w").write(json.dumps(harm))
            print("PRODUCTION HARM SEEN - stopping every user:", harm[:3], flush=True)
        print(f"  t+{int(time.time() - start)}s running; vCPU staging/production {quota[-1][1:] if quota else '?'}", flush=True)
    for p in procs:
        p.join()
    end = time.time()
    json.dump({"stage": stage, "users": len(jobs), "start": start, "end": end, "seconds": seconds,
               "aborted": os.path.exists(ABORT), "production_harm": harm, "vcpu_samples": quota},
              open(os.path.join(OUT, f"s{stage}-run.json"), "w"))
    print(f"stage {stage} done in {int(end - start)}s; aborted={os.path.exists(ABORT)}")
