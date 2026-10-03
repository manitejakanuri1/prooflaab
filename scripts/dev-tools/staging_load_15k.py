"""STAGING ONLY (never production). Progressive load with MANY DIFFERENT students of the
15,000-student synthetic dataset, each doing what a student's dashboard does.

    python scripts/dev-tools/staging_load_15k.py [users ...]        default: 25 50 100 200 400

Each virtual user is a different synthetic student (own RS256 ticket) and repeats the dashboard
mix - today's Lot, task list, Build-log, recordings, squad, leaderboard - with 0.5-1.5 s of
"reading time" between calls, for 40 s per level. A level FAILS when more than 2% of calls
error or p95 goes over 3 s; the run stops at the first failing level.

Staging is deliberately small (API: 2 instances, database pool 2, db-f1-micro), so the level
that fails here is a floor, not production's ceiling.
"""
import concurrent.futures as cf, json, os, random, sys, threading, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

SECONDS = 40
TODAY = time.strftime("%Y-%m-%d")


def sid(n):
    return f"10ad0000-0000-4000-8000-{n:012d}"


def mix(s):
    return [
        ("GET", f"tasks?select=*&student_id=eq.{s}&lot_date=eq.{TODAY}", None),
        ("GET", f"tasks?select=id,title,status,lot_date,sandbox_config_id,rubric_config_id,started_at&student_id=eq.{s}&order=created_at.desc", None),
        ("GET", f"task_submissions?select=id,task_id,status,sandbox_score,created_at,tasks(title,lot_date)&student_id=eq.{s}&order=created_at.desc&limit=200", None),
        ("GET", f"voice_explanations?select=id,task_id,submission_id,status,communication_score,created_at&student_id=eq.{s}&order=created_at.desc&limit=200", None),
        ("POST", "rpc/my_squad_members", {}),
        ("POST", "rpc/get_leaderboard", {"_limit": 100}),
        ("GET", f"student_profiles?select=id,full_name,total_xp,college_id&id=eq.{s}", None),
    ]


def level(users):
    lat, errors, lock = [], {}, threading.Lock()
    stop = time.time() + SECONDS
    picks = random.sample(range(1, 15001), users)
    tokens = {n: st.token(f"user:{sid(n)}", ttl=900) for n in picks}      # minted before the clock starts

    def user(n):
        calls = mix(sid(n))
        headers = {"Authorization": f"Bearer {tokens[n]}", "Content-Type": "application/json"}
        time.sleep(random.random() * 2)                                    # do not all start in the same millisecond
        while time.time() < stop:
            method, path, body = random.choice(calls)
            req = urllib.request.Request(f"{st.API}/{path}", data=json.dumps(body).encode() if body is not None else None,
                                         method=method, headers=headers)
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    r.read(); code = r.status
            except urllib.error.HTTPError as e:
                code = e.code
            except Exception as e:
                code = type(e).__name__
            ms = (time.perf_counter() - t0) * 1000
            with lock:
                lat.append(ms)
                if code != 200:
                    errors[code] = errors.get(code, 0) + 1
            time.sleep(0.5 + random.random())

    with cf.ThreadPoolExecutor(max_workers=users) as ex:
        list(ex.map(user, picks))
    lat.sort()
    n = len(lat)
    pct = lambda p: lat[min(n - 1, int(n * p))] if n else 0
    err = sum(errors.values())
    return {"users": users, "calls": n, "rps": round(n / SECONDS, 1), "p50": round(pct(.5)), "p95": round(pct(.95)),
            "p99": round(pct(.99)), "max": round(lat[-1]) if n else 0, "errors": err,
            "error_pct": round(100 * err / max(n, 1), 2), "error_kinds": errors}


if __name__ == "__main__":
    levels = [int(x) for x in sys.argv[1:]] or [25, 50, 100, 200, 400]
    print(f"{'users':>6} {'calls':>7} {'req/s':>7} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7} {'errors':>8}")
    out = []
    for u in levels:
        r = level(u)
        out.append(r)
        ok = r["error_pct"] <= 2 and r["p95"] <= 3000
        print(f"{r['users']:>6} {r['calls']:>7} {r['rps']:>7} {r['p50']:>5}ms {r['p95']:>5}ms {r['p99']:>5}ms {r['max']:>5}ms "
              f"{r['errors']:>5} ({r['error_pct']}%) {'PASS' if ok else 'FAIL ' + json.dumps(r['error_kinds'])}", flush=True)
        if not ok:
            break
        time.sleep(10)
    json.dump(out, open("e2e-out/load_15k.json", "w"), indent=1)
