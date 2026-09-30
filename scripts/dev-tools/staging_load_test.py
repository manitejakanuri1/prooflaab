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
import base64, concurrent.futures as cf, hashlib, hmac, json, shutil, statistics, subprocess, sys, time, urllib.error, urllib.request, uuid

API = "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app"
FN = "https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app/functions/v1"
BUCKET = "prooflab-staging-private-508214"
T07 = "7d71bff4-1ec2-4778-b26d-9567a416bfac"          # staging test student
TASK = "2881ded8-6d92-45bb-8f0b-31ec62bd926b"          # its written staging task
VOICE_STUDENT = "99999999-0001-0000-0000-000000000006" # fake staging student for voice rows
G = shutil.which("gcloud") or shutil.which("gcloud.cmd")
KEY = subprocess.run([G, "secrets", "versions", "access", "latest", "--secret=prooflab-staging-jwt-secret"],
                     capture_output=True, text=True, check=True).stdout.strip().encode()
b64 = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()

def jwt(claims, ttl=3600):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64(json.dumps({**claims, "exp": int(time.time()) + ttl}).encode())
    return f"{h}.{p}." + b64(hmac.new(KEY, f"{h}.{p}".encode(), hashlib.sha256).digest())

STUDENT = jwt({"role": "authenticated", "sub": T07})
SVC = jwt({"role": "service_role"})

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
    body = {"language": "python", "code": "print(sum(range(1000)))"}
    for u in levels:
        rate, p95 = tier(u, 30, lambda i, n: hit("POST", f"{FN}/run-code", body))
        if rate > 0.05 or p95 > 5000:
            print("stopping: error rate or p95 over the limit"); break

def voice(levels, wav):
    for n in levels:
        stud = jwt({"role": "authenticated", "sub": VOICE_STUDENT})
        tag = uuid.uuid4().hex[:6]
        paths = [f"{VOICE_STUDENT}/loadtest-{tag}-{i}.wav" for i in range(n)]
        for p in paths:
            subprocess.run([G, "storage", "cp", wav, f"gs://{BUCKET}/voice-explanations/{p}", "--content-type=audio/wav"],
                           check=True, capture_output=True)
        t0 = time.time()
        with cf.ThreadPoolExecutor(n) as ex:
            res = list(ex.map(lambda p: hit("POST", f"{FN}/transcription-enqueue",
                                            {"storage_path": p, "idempotency_key": str(uuid.uuid4()), "duration_seconds": 16}, stud), paths))
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
        # clean up the load-test rows and audio
        urllib.request.urlopen(urllib.request.Request(f"{API}/voice_explanations?storage_path=in.({q})", method="DELETE",
                                                      headers={"Authorization": f"Bearer {SVC}"}))
        subprocess.run([G, "storage", "rm", f"gs://{BUCKET}/voice-explanations/{VOICE_STUDENT}/loadtest-{tag}-*"], capture_output=True)

if __name__ == "__main__":
    mode, rest = sys.argv[1], sys.argv[2:]
    if mode == "voice":
        voice([int(x) for x in rest[1:]] or [10], rest[0])
    else:
        lv = [int(x) for x in rest] or [10, 25, 50, 100]
        {"browse": browse, "runcode": runcode}[mode](lv)
