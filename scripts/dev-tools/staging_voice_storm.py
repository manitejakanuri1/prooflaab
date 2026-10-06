"""STAGING ONLY. Duplicate / idempotency storm for Voice (release freeze, 6 Oct 2026).

    python scripts/dev-tools/staging_voice_storm.py

Synthetic students, each with a passed coding submission, record real (synthetic) speech through the real
pipeline. Checks the DATABASE afterwards:
  finalize-x4     the same recording finalized 4 times at once (same idempotency key) -> 1 row, 1 job
  dup-delivery    2 extra Cloud Tasks deliveries for a recording still in flight -> 1 transcript, 1 AI score
  late-delivery   2 extra deliveries AFTER it was scored -> nothing changes, no new AI call
  stale-lease     a late worker callback with an old lease (complete + fail) -> refused, row unchanged
  wrong-task      finalize against another student's task -> refused, nothing stored
  refresh         a new sign-in (new ticket) sees the same accepted recording and result
About 2 AI scoring calls. Results: e2e-out/final/voice-storm.json
"""
import base64, json, os, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

P, R = "prooflab-508214", "asia-south1"
QUEUE = "prooflab-staging-transcription"
WORKER = "https://prooflab-staging-transcription-worker-135298577404.asia-south1.run.app"
INVOKER = "prooflab-staging-tasks-invoker@prooflab-508214.iam.gserviceaccount.com"
FILES = "https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app"
GRADE = "3545a46b-a17f-4f2e-8788-35ada1b5e699"
GCLOUD = "gcloud.cmd" if os.name == "nt" else "gcloud"
ref = st.call("svc", "GET", f"task_sandbox_config?select=reference_solution&id=eq.{GRADE}")[1][0]["reference_solution"]
run = time.strftime("%H%M%S")
tmp = tempfile.mkdtemp()
out = []
SPEECH = ("For this task I read the mark with int input and used an if elif chain. Ninety or more prints A, eighty or more B, "
          "seventy or more C, sixty or more D, and everything else F. I first wrote greater than ninety and the test with "
          "exactly ninety failed, so I changed it to greater than or equal. I also checked zero and one hundred.")


def speak(text):
    path = os.path.join(tmp, "speech.wav")
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.SetOutputToWaveFile('{path}'); $s.Speak('{text}'); $s.Dispose()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    return path


WAV = speak(SPEECH)


def fixture(i):
    who = f"10ad0000-0000-4000-8000-{14980 + i:012d}"
    tid = f"10ad3004-{run[:4]}-4000-8000-{int(run) * 100 + i:012d}"
    c, b = st.call("svc", "POST", "tasks", {"id": tid, "student_id": who, "title": "Convert a mark to a letter grade",
                                            "description": "Read a mark 0-100, print A 90+, B 80+, C 70+, D 60+, else F.",
                                            "category": "technical", "status": "pending", "source": "lot", "lot_category": "technical",
                                            "difficulty": "Easy", "sandbox_config_id": GRADE})
    assert c == 201, (c, b)
    c, b = st.call(f"user:{who}", "FN", "submit-sandbox-task", {"task_id": tid, "code": ref})
    assert c == 200 and b.get("passed"), (c, b)
    return who, tid


def upload(who, tag):
    obj = f"{who}/{run}-{tag}.wav"
    req = urllib.request.Request(f"{FILES}/file/voice-explanations/{obj}", data=open(WAV, "rb").read(), method="PUT",
                                 headers={"Authorization": f"Bearer {st.token('user:' + who)}", "Content-Type": "audio/wav"})
    with urllib.request.urlopen(req, timeout=120) as r:
        assert r.status == 200
    return obj


def finalize(who, tid, obj, key=None):
    return st.call(f"user:{who}", "FN", "transcription-enqueue",
                   {"storage_path": obj, "task_id": tid, "duration_seconds": 25, "idempotency_key": key or f"storm-{obj}"})


def extra_delivery(vid, n):
    """A duplicate Cloud Tasks delivery: same body, new task name, same invoker identity as the real ones."""
    body = json.dumps({"voice_id": vid})
    subprocess.run([GCLOUD, "tasks", "create-http-task", f"storm-{vid[:8]}-{run}-{n}", f"--queue={QUEUE}", f"--location={R}",
                    f"--project={P}", f"--url={WORKER}/transcribe-job", "--method=POST", f"--body-content={body}",
                    "--header=Content-Type: application/json", f"--oidc-service-account-email={INVOKER}",
                    f"--oidc-token-audience={WORKER}"], check=True, capture_output=True)


def row(vid):
    return st.call("svc", "GET", "voice_explanations?select=id,student_id,task_id,submission_id,status,transcription_status,"
                   f"transcript,communication_score,evaluation,attempt_no,current_authoritative&id=eq.{vid}")[1][0]


def wait(vid, limit=600):
    t0 = time.time()
    while time.time() - t0 < limit:
        r = row(vid)
        if r["status"] in ("scored", "failed") and r["transcription_status"] in ("completed", "failed"):
            return r
        time.sleep(6)
    return row(vid)


def ai_calls(who):
    return len(st.call("svc", "GET", f"llm_usage?select=id&student_id=eq.{who}&feature=eq.voice-score")[1])


def record(name, ok, detail):
    out.append({"case": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name:14} {json.dumps(detail, default=str)[:300]}", flush=True)


# finalize-x4 + dup-delivery: one recording, finalized 4 times at once, plus 2 duplicate deliveries in flight
who, tid = fixture(0)
obj = upload(who, "a")
res = [None] * 4
ts = [threading.Thread(target=lambda i: res.__setitem__(i, finalize(who, tid, obj)), args=(i,)) for i in range(4)]
for t in ts: t.start()
for t in ts: t.join()
ids = {b.get("voice_id") for c, b in res if c == 200}
rows_for_key = st.call("svc", "GET", f"voice_explanations?select=id&transcription_idempotency_key=eq.storm-{obj}")[1]
record("finalize-x4", len(ids) == 1 and len(rows_for_key) == 1 and all(c == 200 for c, _ in res),
       {"http": [c for c, _ in res], "voice_ids": len(ids), "rows": len(rows_for_key)})
vid = ids.pop()
extra_delivery(vid, 1); extra_delivery(vid, 2)
final = wait(vid)
time.sleep(20)
after = row(vid)
record("dup-delivery", final["status"] == "scored" and ai_calls(who) == 1 and after["evaluation"] == final["evaluation"]
       and after["transcript"] == final["transcript"],
       {"status": final["status"], "score": final["communication_score"], "ai_calls": ai_calls(who)})

# late-delivery: 2 more deliveries after it was scored
before = row(vid)
extra_delivery(vid, 3); extra_delivery(vid, 4)
time.sleep(45)
now = row(vid)
record("late-delivery", now == before and ai_calls(who) == 1, {"unchanged": now == before, "ai_calls": ai_calls(who)})

# stale-lease: a slow worker comes back with an old lease
c1, b1 = st.call("svc", "RPC", "complete_transcription_job", {"_id": vid, "_lease_token": "00000000-0000-4000-8000-000000000000",
                                                             "_transcript": "OVERWRITE", "_segments": [], "_word_count": 1})
c2, b2 = st.call("svc", "RPC", "fail_transcription_job", {"_id": vid, "_lease_token": "00000000-0000-4000-8000-000000000000",
                                                         "_error": "stale", "_terminal": True})
now2 = row(vid)
record("stale-lease", now2 == before and b1 is not True and b2 is not True, {"complete": (c1, b1), "fail": (c2, b2), "unchanged": now2 == before})

# wrong-task: finalize against another student's task
who2, tid2 = fixture(1)
obj2 = upload(who, "b")
c, b = finalize(who, tid2, obj2)
stored = st.call("svc", "GET", f"voice_explanations?select=id&storage_path=eq.{obj2}")[1]
record("wrong-task", c == 403 and stored == [], {"http": c, "stored": len(stored)})

# refresh: a brand-new ticket for the same student sees the accepted recording and its result
c, mine = st.call(f"user:{who}", "GET", f"voice_explanations?select=id,status,communication_score,current_authoritative&id=eq.{vid}")
record("refresh", c == 200 and len(mine) == 1 and mine[0]["status"] == "scored" and mine[0]["current_authoritative"] is True,
       {"http": c, "rows": mine})

os.makedirs(os.path.join(os.path.dirname(__file__), "..", "..", "e2e-out", "final"), exist_ok=True)
json.dump(out, open(os.path.join(os.path.dirname(__file__), "..", "..", "e2e-out", "final", "voice-storm.json"), "w"), indent=1, default=str)
print(f"\n{sum(r['ok'] for r in out)}/{len(out)} voice storm cases clean")
