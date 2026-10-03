"""STAGING ONLY stepped load test (never production). Staging is ~half of production's capacity
(api/functions max 2 instances vs 4, DB pool 2 vs 4, code runner 2 vs 6, db-f1-micro vs db-g1-small),
so results are a conservative lower bound.

Scenarios (a signed-in staging test student; token minted in memory from the staging JWT secret):
  browse  - dashboard reads (tasks, today's Lot), written task view, Build-Log polling (PostgREST)
  runcode - Run button (functions run-code -> code runner)
  voice   - N async recordings queued at once (files object -> transcription-enqueue -> Cloud Tasks
            -> worker -> Whisper -> scoring); measures how long the queue takes to drain
Stops a scenario early when errors exceed 5% or p95 exceeds 5 s.
usage: python scripts/dev-tools/staging_load_test.py browse|runcode|voice [levels...]
"""
import random
import base64, concurrent.futures as cf, hashlib, hmac, json, shutil, statistics, subprocess, sys, time, urllib.error, urllib.request, uuid

API = "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app"
FN = "https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app/functions/v1"
BUCKET = "prooflab-staging-private-508214"
T07 = "7d71bff4-1ec2-4778-b26d-9567a416bfac"          # staging test student
TASK = "2881ded8-6d92-45bb-8f0b-31ec62bd926b"          # its written staging task
VOICE_STUDENT = "99999999-0001-0000-0000-000000000001" # staging fixture with a submitted task
VOICE_TASK = "e4e25563-6072-42a7-8c8a-79efce3bb649"     # a recording must belong to a submission (migration 61)
G = shutil.which("gcloud") or shutil.which("gcloud.cmd")
# Tickets are signed with the staging signing key (F1: the bridge signs RS256; the old shared
# HS256 secret is refused on staging), through the same helper every staging check uses.
sys.path.insert(0, __import__("os").path.dirname(__file__))
import st  # noqa: E402

STUDENT = st.token(f"user:{T07}", ttl=3600)
SVC = st.token("svc", ttl=3600)

def hit(method, url, body=None, token=STUDENT):
    t0 = time.perf_counter()
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read(); code = r.status
            if b'"status":"busy"' in body.replace(b" ", b""):
                code = 299   # run-code answers 200 + status busy when the runner is full: count it apart
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        code = 0
    return code, (time.perf_counter() - t0) * 1000

BROWSE = [
    ("GET", f"{API}/tasks?select=id,title,status&student_id=eq.{T07}&limit=20", None),
    ("POST", f"{API}/rpc/my_todays_lot", {}),
    ("POST", f"{API}/rpc/rubric_task_view", {"_task_id": TASK}),
    ("GET", f"{API}/voice_explanations?select=id,status,transcription_status&student_id=eq.{T07}&order=created_at.desc&limit=10", None),
]

def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]

def tier(users, seconds, work):
    lat, codes, stop = [], [], time.time() + seconds
    def user(i):
        n = 0
        while time.time() < stop:
            c, ms = work(i, n); codes.append(c); lat.append(ms); n += 1
    with cf.ThreadPoolExecutor(users) as ex:
        list(ex.map(user, range(users)))
    errs = sum(1 for c in codes if not (200 <= c < 299))
    busy = sum(1 for c in codes if c == 299)
    rate = errs / max(1, len(codes))
    print(f"users={users:4} requests={len(codes):6} rps={len(codes)/seconds:7.1f} p50={pct(lat,50):7.0f}ms p95={pct(lat,95):7.0f}ms "
          f"p99={pct(lat,99):7.0f}ms errors={errs} ({rate:.1%}) busy={busy} codes={sorted(set(codes))}", flush=True)
    return rate, pct(lat, 95)

def browse(levels):
    for u in levels:
        rate, p95 = tier(u, 30, lambda i, n: hit(*BROWSE[(i + n) % len(BROWSE)]))
        if rate > 0.05 or p95 > 5000:
            print("stopping: error rate or p95 over the limit"); break

def runcode(levels):
    # One synthetic student per virtual user: Run is limited to 120 an hour per student
    # (and that limit works - a single shared student is refused with 429 almost at once).
    body = {"language": "python", "code": "print(sum(range(1000)))"}
    for u in levels:
        toks = [st.token(f"user:10ad0000-0000-4000-8000-{random.randint(1, 15000):012d}", ttl=900) for _ in range(u)]
        def work(i, n):
            time.sleep(0.5)                       # a person does not press Run more than about once a second
            return hit("POST", f"{FN}/run-code", body, toks[i])
        rate, p95 = tier(u, 30, work)
        if rate > 0.05 or p95 > 5000:
            print("stopping: error rate or p95 over the limit"); break

def voice(levels, wav):
    for n in levels:
        stud = st.token(f"user:{VOICE_STUDENT}", ttl=3600)
        tag = uuid.uuid4().hex[:6]
        paths = [f"{VOICE_STUDENT}/loadtest-{tag}-{i}.wav" for i in range(n)]
        for p in paths:
            subprocess.run([G, "storage", "cp", wav, f"gs://{BUCKET}/voice-explanations/{p}", "--content-type=audio/wav"],
                           check=True, capture_output=True)
        t0 = time.time()
        with cf.ThreadPoolExecutor(n) as ex:
            res = list(ex.map(lambda p: hit("POST", f"{FN}/transcription-enqueue",
                                            {"storage_path": p, "task_id": VOICE_TASK, "idempotency_key": str(uuid.uuid4()), "duration_seconds": 16}, stud), paths))
        enq = [ms for c, ms in res]
        print(f"voice n={n}: enqueue ok={sum(1 for c,_ in res if c==200)}/{n} p50={pct(enq,50):.0f}ms p95={pct(enq,95):.0f}ms", flush=True)
        q = ",".join(f'"{p}"' for p in paths)
        while time.time() - t0 < 900:
            req = urllib.request.Request(f"{API}/voice_explanations?select=status,transcription_status&storage_path=in.({q})",
                                         headers={"Authorization": f"Bearer {SVC}"})
            rows = json.loads(urllib.request.urlopen(req).read())
            done = sum(1 for r in rows if r["status"] == "scored"); failed = sum(1 for r in rows if r["transcription_status"] == "failed")
            if done + failed == n:
                break
            time.sleep(10)
        dur = time.time() - t0
        print(f"voice n={n}: scored={done} failed={failed} all done in {dur:.0f}s -> {n/dur*60:.1f} recordings/min", flush=True)
        # Recordings are evidence and are not deleted (migration 61): the synthetic rows stay
        # on the staging fixture; only the uploaded audio is removed.
        subprocess.run([G, "storage", "rm", f"gs://{BUCKET}/voice-explanations/{VOICE_STUDENT}/loadtest-{tag}-*"], capture_output=True)

if __name__ == "__main__":
    mode, rest = sys.argv[1], sys.argv[2:]
    if mode == "voice":
        voice([int(x) for x in rest[1:]] or [10], rest[0])
    else:
        lv = [int(x) for x in rest] or [10, 25, 50, 100]
        {"browse": browse, "runcode": runcode}[mode](lv)
