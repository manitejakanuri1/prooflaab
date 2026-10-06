"""STAGING ONLY: recreate the voice-reaper proof on demand, then clean up after itself.

Creates three labelled REAPTEST recordings for a fake staging student, backed by a real audio file:
  stale   - pending, never enqueued, 5 min old     -> the reaper must recover it (transcript + score)
  healthy - processing, claimed just now          -> the reaper must NOT touch it in its first 100 s
  limit   - pending at the recovery limit (8)     -> the reaper must fail it safely and alert
Watches the staging reaper (Cloud Scheduler prooflab-staging-transcription-reap, every minute),
prints PASS/FAIL, then deletes the rows and audio it created (keep them with --keep).
The staging JWT secret is read from Secret Manager into memory only; nothing secret is printed.

usage: python scripts/dev-tools/staging_reaper_fixture.py <speech.wav> [--keep]
Costs: one Whisper transcription + one or two DeepSeek scoring calls on staging.
"""
import base64, datetime, hashlib, hmac, json, os, shutil, subprocess, sys, time, urllib.error, urllib.request, uuid

API = "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app"
BUCKET = "prooflab-staging-private-508214"
STUDENT = "99999999-0001-0000-0000-000000000006"   # fake staging fixture student
G = shutil.which("gcloud") or shutil.which("gcloud.cmd")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import st as sthelp  # noqa: E402  - staging tickets are RS256-signed since F1; the old shared-secret ticket is refused


def token():
    return sthelp.token("svc", ttl=900)

def call(verb, path, body=None):
    req = urllib.request.Request(f"{API}/{path}", data=json.dumps(body).encode() if body is not None else None, method=verb,
                                 headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json",
                                          "Prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read().decode(); return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def main():
    wav, keep = sys.argv[1], "--keep" in sys.argv
    tag = uuid.uuid4().hex[:6]
    now = datetime.datetime.now(datetime.timezone.utc)
    iso = lambda d: d.isoformat()
    spec = {
        "stale": {"transcription_status": "pending", "created_at": iso(now - datetime.timedelta(minutes=5))},
        "healthy": {"transcription_status": "processing", "created_at": iso(now - datetime.timedelta(minutes=1)),
                    "transcription_claimed_at": iso(now), "transcription_lease_token": str(uuid.uuid4()),
                    "transcription_attempts": 1, "transcription_enqueued_at": iso(now - datetime.timedelta(seconds=50))},
        "limit": {"transcription_status": "pending", "created_at": iso(now - datetime.timedelta(minutes=30)),
                  "transcription_reap_attempts": 8},
    }
    rows = {}
    for name, extra in spec.items():
        path = f"{STUDENT}/reaptest-{tag}-{name}.wav"
        subprocess.run([G, "storage", "cp", wav, f"gs://{BUCKET}/voice-explanations/{path}", "--content-type=audio/wav"],
                       check=True, capture_output=True)
        st, out = call("POST", "voice_explanations", {"student_id": STUDENT, "storage_path": path, "duration_seconds": 16,
                                                        "transcript": None, "transcript_source": "server",
                                                        "transcription_idempotency_key": str(uuid.uuid4()), **extra})
        assert st == 201, (name, st, out)
        rows[name] = out[0]["id"]
    cols = "transcription_status,status,communication_score,transcription_reap_attempts,transcription_error"
    get = lambda n: call("GET", f"voice_explanations?select={cols}&id=eq.{rows[n]}")[1][0]
    t0, healthy_ok = time.time(), True
    while time.time() - t0 < 420:
        s, h, l = get("stale"), get("healthy"), get("limit")
        el = time.time() - t0
        if el <= 100 and (h["transcription_reap_attempts"] > 0 or h["transcription_status"] != "processing"):
            healthy_ok = False
        print(f"t+{int(el):3}s stale={s['transcription_status']}/{s['status']} score={s['communication_score']} | "
              f"healthy reap={h['transcription_reap_attempts']} | limit={l['transcription_status']}")
        if s["status"] == "scored" and l["transcription_status"] == "failed" and el >= 100:
            break
        time.sleep(20)
    s, l = get("stale"), get("limit")
    checks = [("stale recovered to transcript + score", s["transcription_status"] == "completed" and s["status"] == "scored"),
              ("healthy untouched for 100 s", healthy_ok),
              ("limit failed safely", l["transcription_status"] == "failed" and l["transcription_error"] == "exceeded automatic recovery attempts")]
    for n, ok in checks:
        print(("PASS  " if ok else "FAIL  ") + n)
    if not keep:
        call("DELETE", "voice_explanations?id=in.(" + ",".join(rows.values()) + ")")
        subprocess.run([G, "storage", "rm", f"gs://{BUCKET}/voice-explanations/{STUDENT}/reaptest-{tag}-*"], capture_output=True)
        print("cleaned up the fixture rows and audio")
    sys.exit(0 if all(ok for _, ok in checks) else 1)

if __name__ == "__main__":
    main()
