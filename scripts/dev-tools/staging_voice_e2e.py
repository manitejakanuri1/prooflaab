"""STAGING ONLY. Real audio through the real pipeline: files -> transcription-enqueue ->
Cloud Tasks -> worker -> Whisper -> voice-score (DeepSeek, 2 paid calls, well under Rs 1).

Speech is synthesised on this machine (Windows SAPI), so no real person's voice is used.
Proves: content-linked scoring (on-topic vs off-topic), silence handling, "submit first",
write-once audio, attempt history with one authoritative recording.

    python scripts/dev-tools/staging_voice_e2e.py
"""
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, uuid, wave

sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

FILES = "https://prooflab-staging-files-135298577404.asia-south1.run.app"
S = "99999999-0001-0000-0000-000000000001"
TASK_DONE = "e4e25563-6072-42a7-8c8a-79efce3bb649"
TASK_NEW = "b1f20882-34ff-4701-adab-60cc6c1444e5"
WHO = f"user:{S}"
run = uuid.uuid4().hex[:8]
tmp = tempfile.mkdtemp()

ON_TOPIC = ("For this task I read the log line by line. I split each line and checked if the status was failed. "
            "I kept a dictionary where the key is the user name and the value is the count of failed logins. "
            "At first I forgot users with zero failures and my output had the wrong order, so I sorted the names "
            "before printing. I am still not sure if my code handles an empty log correctly.")
OFF_TOPIC = ("Yesterday I went to the market with my cousin and we bought mangoes and some vegetables. "
             "After that we watched a cricket match on television and our team won by five wickets. "
             "In the evening it rained heavily so we stayed at home and had tea with snacks and talked about holidays.")


def speak(text, name):
    path = os.path.join(tmp, name)
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.Rate = 0; $s.SetOutputToWaveFile('{path}'); $s.Speak('{text}'); $s.Dispose()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    return path


def silence(name, seconds=6):
    path = os.path.join(tmp, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000 * seconds)
    return path


def put(local, obj, upsert=False):
    req = urllib.request.Request(f"{FILES}/file/voice-explanations/{obj}", data=open(local, "rb").read(), method="PUT",
                                 headers={"Authorization": f"Bearer {st.token(WHO)}", "Content-Type": "audio/wav",
                                          **({"x-upsert": "true"} if upsert else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def enqueue(obj, task, seconds):
    return st.call(WHO, "FN", "transcription-enqueue",
                   {"storage_path": obj, "task_id": task, "duration_seconds": seconds, "idempotency_key": f"voicee2e-{obj}"})


def wait(voice_id, limit=300):
    t0 = time.time()
    while time.time() - t0 < limit:
        _, rows = st.call("svc", "GET", "voice_explanations?select=status,transcription_status,transcript,word_count,"
                          f"communication_score,communication_notes,evaluation,attempt_no,current_authoritative,submission_id&id=eq.{voice_id}")
        r = rows[0]
        if r["status"] in ("scored", "failed") and r["transcription_status"] in ("completed", "failed"):
            return r, round(time.time() - t0)
        time.sleep(6)
    return r, limit


results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:220], flush=True)


# 1. No submission yet -> refused before anything is queued.
c, b = enqueue(f"{S}/voicee2e-{run}-none.wav", TASK_NEW, 10)
check("enqueue refused when the task has no submission", c == 409 and b.get("code") == "submission_required", (c, b))

# 2. On-topic explanation.
on = f"{S}/voicee2e-{run}-on.wav"
check("audio uploaded", put(speak(ON_TOPIC, "on.wav"), on) == 200)
check("same audio path cannot be overwritten (write-once)", put(silence("x.wav", 1), on, upsert=True) == 409)
c, b = enqueue(on, TASK_DONE, 30)
check("enqueue accepted, student can continue", c == 200 and b.get("status") == "pending", (c, b))
r_on, secs = wait(b["voice_id"])
print("   transcript:", (r_on["transcript"] or "")[:160])
check(f"on-topic: transcribed and scored in {secs}s", r_on["status"] == "scored" and (r_on["word_count"] or 0) > 40, (r_on["status"], r_on["communication_notes"]))
ev = r_on["evaluation"] or {}
check("on-topic: evaluation saved with version, linked to the submission, high content match",
      ev.get("evaluator_version") == "voice-eval-2" and ev.get("linked_to_submission") is True and (ev.get("content_match") or 0) >= 60,
      (r_on["communication_score"], ev))

# 3. Off-topic explanation on the same submission (a retry).
off = f"{S}/voicee2e-{run}-off.wav"
put(speak(OFF_TOPIC, "off.wav"), off)
c, b = enqueue(off, TASK_DONE, 25)
r_off, secs = wait(b["voice_id"])
ev = r_off["evaluation"] or {}
check(f"off-topic: scored in {secs}s, low content match, score capped at 30",
      r_off["status"] == "scored" and (ev.get("content_match") if ev.get("content_match") is not None else 100) < 30
      and r_off["communication_score"] <= 30 and "off_topic" in (ev.get("flags") or []),
      (r_off["communication_score"], ev, r_off["communication_notes"]))
check("retry kept as history: later attempt number, same submission",
      r_off["attempt_no"] == r_on["attempt_no"] + 1 and r_off["submission_id"] == r_on["submission_id"],
      (r_on["attempt_no"], r_off["attempt_no"]))
_, rows = st.call("svc", "GET", f"voice_explanations?select=attempt_no,current_authoritative&submission_id=eq.{r_on['submission_id']}&current_authoritative=is.true")
check("exactly one authoritative recording: the newest", len(rows) == 1 and rows[0]["attempt_no"] == r_off["attempt_no"], rows)

# 4. Silence.
sil = f"{S}/voicee2e-{run}-silence.wav"
put(silence("silence.wav"), sil)
c, b = enqueue(sil, TASK_DONE, 6)
r_s, secs = wait(b["voice_id"])
check(f"silence: not scored, clear message, no AI spend ({secs}s)",
      r_s["status"] == "failed" and r_s["communication_score"] is None and r_s["evaluation"] is None,
      (r_s["status"], r_s["transcription_status"], r_s["communication_notes"]))

# 5. A scored result cannot be edited afterwards, even by the server.
c, b = st.call("svc", "PATCH", f"voice_explanations?submission_id=eq.{r_on['submission_id']}&attempt_no=eq.{r_on['attempt_no']}", {"communication_score": 99})
check("scored result cannot be edited", c >= 400, (c, b))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
