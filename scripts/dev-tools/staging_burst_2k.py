"""STAGING ONLY. Controlled bursts and interference (release steps 13 and 18).

    python scripts/dev-tools/staging_burst_2k.py <scenario> <n>

Scenarios (each user is a different synthetic student, all fire within ~1 s):
  reads     n students each read Floor + Build-log + Squad 5 times (browsing only)
  run       n students press Run once (stage-9 coding tasks; Run never stores anything)
  submit    n students press Submit once (stage-8 coding tasks; reconciled afterwards)
  submit-fresh  n students press Submit once on a brand-new task each (real grading every time)
  voice     n students upload + queue a recording (stage-8 tasks that have a submission)
  mixed     n/2 Run + n/2 reads at the same moment, while the voice queue may be busy
Every result line goes to e2e-out/load2k/burst-<scenario>-<n>.json.
"""
import asyncio, json, os, sys, time, uuid
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402
import httpx

FILES = "https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app"
WAV = open(os.path.join("e2e-out", "loadvoice.wav"), "rb").read()


def sid(n):
    return f"10ad0000-0000-4000-8000-{n:012d}"


def tasks(stage, kind_code=True):
    _, b = st.call("svc", "GET", f"tasks?select=id,student_id,sandbox_config_id&title=like.LOAD2K%20s{stage}%20code*&limit=2000")
    return b


async def main(scenario, n, part=0, parts=1, at=None, rows=None):
    rows = [] if rows is None else rows
    refs = {c["id"]: c["reference_solution"] for c in st.call("svc", "GET", "task_sandbox_config?select=id,reference_solution&id=in.(452e588c-42b6-4f55-bf5c-b7090cad2a09,3545a46b-a17f-4f2e-8788-35ada1b5e699)")[1]}
    if scenario == "submit-fresh":
        # Real grading under load: every student gets a brand-new coding task (made once, by part 0's caller).
        pool = json.load(open(os.path.join("e2e-out", "load2k", "fresh-tasks.json")))[:n][part::parts]
    else:
        pool = tasks(9 if scenario in ("run", "mixed", "reads") else 8)[:n][part::parts]
    if at:
        await asyncio.sleep(max(0, at - time.time()))
    async with httpx.AsyncClient(limits=httpx.Limits(max_connections=n + 20)) as client:
        async def call(kind, method, url, tok, body=None, raw=None, ctype="application/json"):
            t0 = time.time()
            try:
                r = await client.request(method, url, headers={"Authorization": f"Bearer {tok}", "Content-Type": ctype}, timeout=120,
                                         content=raw if raw is not None else (json.dumps(body) if body is not None else None))
                code = r.status_code
            except httpx.TimeoutException:
                code = "timeout"
            except Exception as e:
                code = type(e).__name__
            rows.append({"kind": kind, "code": code, "ms": round((time.time() - t0) * 1000)})
            return code

        async def user(i, t):
            s = t["student_id"]
            tok = st.token(f"user:{s}", ttl=3600)
            await asyncio.sleep((i % 50) / 50)          # all inside about one second
            if scenario == "reads" or (scenario == "mixed" and i % 2):
                for _ in range(5):
                    await call("read", "POST", f"{st.API}/rpc/my_todays_lot", tok, {})
                    await call("read", "GET", f"{st.API}/task_submissions?select=id,status,sandbox_score&student_id=eq.{s}&limit=50", tok)
                    await call("read", "POST", f"{st.API}/rpc/my_squad_members", tok, {})
            elif scenario in ("run", "mixed"):
                await call("run", "POST", f"{st.FUNCTIONS}/run-sandbox", tok, {"task_id": t["id"], "code": refs[t["sandbox_config_id"]]})
            elif scenario in ("submit", "submit-fresh"):
                await call("submit", "POST", f"{st.FUNCTIONS}/submit-sandbox-task", tok, {"task_id": t["id"], "code": refs[t["sandbox_config_id"]]})
            elif scenario == "voice":
                code = await call("submit", "POST", f"{st.FUNCTIONS}/submit-sandbox-task", tok, {"task_id": t["id"], "code": refs[t["sandbox_config_id"]]})
                path = f"{s}/{int(time.time() * 1000)}-burst.wav"
                if await call("voice_upload", "PUT", f"{FILES}/file/voice-explanations/{path}", tok, raw=WAV, ctype="audio/wav") == 200:
                    await call("voice_enqueue", "POST", f"{st.FUNCTIONS}/transcription-enqueue", tok,
                               {"storage_path": path, "task_id": t["id"], "duration_seconds": 17, "idempotency_key": str(uuid.uuid4())})

        t0 = time.time()
        await asyncio.gather(*(user(i, t) for i, t in enumerate(pool)))
    return rows


def proc(scenario, n, part, parts, at, path):
    rows = asyncio.run(main(scenario, n, part, parts, at))
    json.dump(rows, open(path, "w"))


if __name__ == "__main__":
    import multiprocessing as mp
    scenario, n = sys.argv[1], int(sys.argv[2])
    if scenario == "submit-fresh":
        base = tasks(8)[:n]
        tag = time.strftime("%H%M%S")
        fresh = []
        for i in range(0, len(base), 200):
            rows_ = [{"student_id": t["student_id"], "title": f"LOAD2K fresh {tag} {i + j}", "description": "load", "category": "technical",
                      "status": "pending", "source": "lot", "lot_category": "technical", "difficulty": "Easy",
                      "sandbox_config_id": t["sandbox_config_id"]} for j, t in enumerate(base[i:i + 200])]
            c, b = st.call("svc", "POST", "tasks", rows_)
            assert c == 201, (c, str(b)[:200])
            fresh += [{"id": r["id"], "student_id": r["student_id"], "sandbox_config_id": r["sandbox_config_id"]} for r in b]
        json.dump(fresh, open(os.path.join("e2e-out", "load2k", "fresh-tasks.json"), "w"))
    parts = max(1, n // 50)          # one client process per 50 users, so the client is never the bottleneck
    at = time.time() + 15 + parts * 0.5
    paths = [os.path.join("e2e-out", "load2k", f"burst-tmp-{i}.json") for i in range(parts)]
    ps = [mp.Process(target=proc, args=(scenario, n, i, parts, at, paths[i])) for i in range(parts)]
    for p_ in ps: p_.start()
    for p_ in ps: p_.join()
    rows = [r for f in paths for r in json.load(open(f))]
    for f in paths: os.remove(f)
    wall = max(1, (time.time() - at))
    out = {"scenario": scenario, "n": n, "client_processes": parts, "wall_seconds": round(wall, 1), "start": at, "kinds": {}}
    for k in sorted({r["kind"] for r in rows}):
        lat = sorted(r["ms"] for r in rows if r["kind"] == k)
        codes = {}
        for r in rows:
            if r["kind"] == k:
                codes[str(r["code"])] = codes.get(str(r["code"]), 0) + 1
        q = lambda x: lat[min(len(lat) - 1, int(len(lat) * x))]
        out["kinds"][k] = {"n": len(lat), "p50": q(.5), "p95": q(.95), "p99": q(.99), "max": lat[-1], "codes": codes}
    json.dump(out, open(os.path.join("e2e-out", "load2k", f"burst-{scenario}-{n}.json"), "w"), indent=1)
    print(json.dumps(out))
