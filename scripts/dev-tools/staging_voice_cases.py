"""STAGING ONLY. Voice scoring quality and reproducibility (release audit, steps 4-5).

    python scripts/dev-tools/staging_voice_cases.py

Fifteen controlled cases (A-O) through the REAL pipeline: synthetic speech (Windows SAPI, en-US
voices only - this proves function, never Indian-English accuracy) -> files -> transcription-
enqueue -> Cloud Tasks -> worker -> Whisper -> voice-score (DeepSeek). Each case has its own
synthetic student, task (mark -> letter grade problem) and passed submission of the reference
code, so every recording is bound to known work. Expected outcomes are written before running.
Then reproducibility: the same audio for three cases is recorded again 4 more times on the
same submission (new attempts), and the spread of score / content match is reported.
About 30 AI scoring calls, roughly Rs 1. Results: e2e-out/voice-cases.json
"""
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, wave
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

FILES = "https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app"
GRADE = "3545a46b-a17f-4f2e-8788-35ada1b5e699"
tmp = tempfile.mkdtemp()
run = time.strftime("%H%M%S")
ref = st.call("svc", "GET", f"task_sandbox_config?select=reference_solution&id=eq.{GRADE}")[1][0]["reference_solution"]

T = {
    "A": ("For this task I read the mark with int input and then used an if elif chain. If the mark is ninety or more it prints A, "
          "eighty or more prints B, seventy or more C, sixty or more D, and everything else F. At first I wrote greater than ninety "
          "and the test with exactly ninety failed, so I changed it to greater than or equal. I also checked zero and one hundred. "
          "I am not fully sure what should happen for a negative mark, my code just prints F."),
    "B": "I read the mark and if it is ninety or more I print A. The other grades work in a similar way going down. That is basically it.",
    "C": ("I read the mark and printed the grade. I think ninety and above is A and anything above fifty is a pass so it prints D, "
          "and below fifty is F. I used if statements for that and it worked for the examples."),
    "D": ("I solved this with a binary search over a sorted list of grade boundaries and I cached every answer in a hash map "
          "so repeated marks are instant. I also used recursion to walk down the boundaries. This makes it run in log n time."),
    "E": ("Yesterday I went to the market with my cousin and we bought mangoes and vegetables. Then we watched a cricket match and "
          "our team won by five wickets. In the evening it rained so we stayed home and had tea."),
    "F": ("I did not use any if statements at all. I built a dictionary that maps every single mark from zero to one hundred to "
          "its grade and then I just look the mark up in that dictionary and print the value."),
    "G": ("I wrote clean and efficient code following best practices. I made sure the logic is correct and I tested it properly. "
          "Coding is all about problem solving and logical thinking, and I always try to write readable code."),
    "H": "I wrote the grade code.",
    "K": ("Mera code pehle mark read karta hai int input se, phir if elif chain lagaya, ninety se upar A, eighty se upar B, "
          "seventy C, sixty D, baaki sab F. Pehle greater than likha tha, ninety wala test fail hua, toh greater than equal kiya."),
    "L": ("I used m equals int of input, then if m greater than or equal to ninety print A, elif m greater than or equal to eighty "
          "print B, elif seventy print C, elif sixty print D, else print F. The stdin has one integer, and the expected output "
          "is one letter with a newline. I tested the boundary values ninety, seventy nine and fifty nine."),
    "M": ("My program reads the number of log lines, then for each line it splits the user name and the status. If the status is "
          "FAIL I add one to a dictionary counter for that user. At the end I sort the user names and print each name with "
          "its count of failed logins."),
}
EXPECT = {
    "A": "scored; score >= 60; content_match >= 70",
    "B": "scored; lower than A",
    "C": "scored; lower than A (wrong thresholds)",
    "D": "scored; content_match < 50 (describes code that is not there)",
    "E": "scored; off_topic; score <= 30",
    "F": "scored; content_match < 50 (contradicts the submitted if/elif code)",
    "G": "scored; score <= 50 (generic, nothing from this work)",
    "H": "failed: too little speech; no score; no AI call",
    "I": "failed: silence; no score; no AI call",
    "J": "refused: non_english; no score; asked to record in English",
    "K": "not refused as non-English (uncertain language is accepted); scored",
    "L": "accepted as English despite code terms; scored; score >= 60",
    "M": "scored; content_match < 40; capped/off_topic (explains other code)",
    "N": "replay of A: new attempt becomes the one authoritative recording; score within 15 of A",
    "O": "evaluator failure: no score saved (unit test with a failing AI; live fault injection not possible safely)",
}


def speak(text, name):
    path = os.path.join(tmp, name)
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.Rate = 0; $s.SetOutputToWaveFile('{path}'); $s.Speak('{text}'); $s.Dispose()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    return path


def silence(name, seconds=8):
    path = os.path.join(tmp, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b"\x00\x00" * 16000 * seconds)
    return path


def put(who, local, obj, ctype="audio/wav"):
    req = urllib.request.Request(f"{FILES}/file/voice-explanations/{obj}", data=open(local, "rb").read(), method="PUT",
                                 headers={"Authorization": f"Bearer {st.token('user:' + who)}", "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def wait(vid, limit=900):
    t0 = time.time()
    while time.time() - t0 < limit:
        r = st.call("svc", "GET", "voice_explanations?select=id,status,transcription_status,transcript,word_count,communication_score,"
                    f"communication_notes,evaluation,attempt_no,current_authoritative,submission_id,transcription_error&id=eq.{vid}")[1][0]
        if r["status"] in ("scored", "failed") and r["transcription_status"] in ("completed", "failed"):
            return r, round(time.time() - t0)
        time.sleep(8)
    return r, limit


def fixture(i):
    who = f"10ad0000-0000-4000-8000-{14700 + i:012d}"
    tid = f"10ad3002-{run[:4]}-4000-8000-{int(run) * 100 + i:012d}"
    c, b = st.call("svc", "POST", "tasks", {"id": tid, "student_id": who, "title": "Convert a mark to a letter grade",
                                            "description": "Read a mark from 0 to 100 and print its letter grade: A 90+, B 80+, C 70+, D 60+, else F.",
                                            "category": "technical", "status": "pending", "source": "lot", "lot_category": "technical",
                                            "difficulty": "Easy", "sandbox_config_id": GRADE})
    assert c == 201, (c, b)
    c, b = st.call(f"user:{who}", "FN", "submit-sandbox-task", {"task_id": tid, "code": ref})
    assert c == 200 and b.get("passed"), (c, b)
    return who, tid


def record(who, tid, local, tag, seconds=30, ctype="audio/wav"):
    obj = f"{who}/{run}-{tag}.{local.rsplit('.', 1)[-1]}"
    assert put(who, local, obj, ctype) == 200
    c, b = st.call(f"user:{who}", "FN", "transcription-enqueue", {"storage_path": obj, "task_id": tid, "duration_seconds": seconds,
                                                                   "idempotency_key": f"vcase-{obj}"})
    assert c == 200, (c, b)
    return b["voice_id"]


def summary(r):
    ev = r.get("evaluation") or {}
    tr = ev.get("transcription") or {}
    return {"status": r["status"], "score": r["communication_score"], "content_match": ev.get("content_match"), "flags": ev.get("flags"),
            "version": ev.get("evaluator_version"), "language": tr.get("language"), "lang_p": tr.get("language_probability"),
            "gate": tr.get("gate"), "error": r.get("transcription_error"), "notes": r["communication_notes"],
            "transcript": (r.get("transcript") or "")[:200], "attempt": r["attempt_no"], "authoritative": r["current_authoritative"],
            "submission": r["submission_id"]}


audio = {k: speak(v, f"{k}.wav") for k, v in T.items()}
audio["I"] = silence("I.wav")
hindi = os.path.join(tmp, "J.ogg")
open(hindi, "wb").write(urllib.request.urlopen(urllib.request.Request(
    "https://upload.wikimedia.org/wikipedia/commons/f/fe/Hindi_Dengue_Introduction.ogg",
    headers={"User-Agent": "ProofLabStagingTest/1.0 (staging language-gate test)"}), timeout=60).read())
audio["J"] = hindi

fx, vids = {}, {}
for i, k in enumerate("ABCDEFGHIJKLM"):
    fx[k] = fixture(i)
    vids[k] = record(*fx[k], audio[k], k, ctype="audio/ogg" if k == "J" else "audio/wav")
    print("queued", k, flush=True)
res = {}
for k in "ABCDEFGHIJKLM":
    r, secs = wait(vids[k])
    res[k] = {**summary(r), "seconds": secs}
    print(k, json.dumps({x: res[k][x] for x in ("status", "score", "content_match", "flags", "language", "gate", "error")}), flush=True)

# N: replay A's exact audio as a new attempt on the same submission.
n = record(*fx["A"], audio["A"], "N")
r, secs = wait(n)
res["N"] = {**summary(r), "seconds": secs}
auth = st.call("svc", "GET", f"voice_explanations?select=attempt_no&submission_id=eq.{res['N']['submission']}&current_authoritative=is.true")[1]
res["N"]["authoritative_rows"] = auth

ok = {
    "A": res["A"]["status"] == "scored" and (res["A"]["score"] or 0) >= 60 and (res["A"]["content_match"] or 0) >= 70,
    "B": res["B"]["status"] == "scored" and (res["B"]["score"] or 0) < (res["A"]["score"] or 0),
    "C": res["C"]["status"] == "scored" and (res["C"]["score"] or 0) < (res["A"]["score"] or 0),
    "D": res["D"]["status"] == "scored" and (res["D"]["content_match"] if res["D"]["content_match"] is not None else 100) < 50,
    "E": res["E"]["status"] == "scored" and "off_topic" in (res["E"]["flags"] or []) and (res["E"]["score"] or 0) <= 30,
    "F": res["F"]["status"] == "scored" and (res["F"]["content_match"] if res["F"]["content_match"] is not None else 100) < 50,
    "G": res["G"]["status"] == "scored" and (res["G"]["score"] or 0) <= 50,
    "H": res["H"]["status"] == "failed" and res["H"]["score"] is None,
    "I": res["I"]["status"] == "failed" and res["I"]["score"] is None,
    "J": res["J"]["status"] == "failed" and res["J"]["error"] == "non_english" and res["J"]["score"] is None,
    "K": res["K"]["error"] != "non_english" and res["K"]["status"] == "scored",
    "L": res["L"]["status"] == "scored" and res["L"]["gate"] == "english" and (res["L"]["score"] or 0) >= 60,
    "M": res["M"]["status"] == "scored" and (res["M"]["content_match"] if res["M"]["content_match"] is not None else 100) < 40,
    "N": res["N"]["status"] == "scored" and len(auth) == 1 and auth[0]["attempt_no"] == res["N"]["attempt"]
         and abs((res["N"]["score"] or 0) - (res["A"]["score"] or 0)) <= 15,
}

# Reproducibility: same audio, same submission, 4 more attempts for A, B and G.
repro = {}
for k in "ABG":
    scores = [(res[k]["score"], res[k]["content_match"], res[k]["transcript"])]
    for j in range(4):
        v = record(*fx[k], audio[k], f"{k}r{j}")
        r, _ = wait(v)
        s = summary(r)
        scores.append((s["score"], s["content_match"], s["transcript"]))
    sc = [x[0] for x in scores if x[0] is not None]
    cm = [x[1] for x in scores if x[1] is not None]
    repro[k] = {"scores": sc, "content_match": cm, "score_range": (max(sc) - min(sc)) if sc else None,
                "content_match_range": (max(cm) - min(cm)) if cm else None, "same_transcript": len({x[2] for x in scores}) == 1}
    print("repro", k, repro[k], flush=True)

json.dump({"run": run, "expected": EXPECT, "results": res, "ok": ok, "reproducibility": repro},
          open(os.path.join(os.path.dirname(__file__), "..", "..", "e2e-out", "voice-cases.json"), "w"), indent=1)
for k in "ABCDEFGHIJKLMN":
    print(f"{'OK ' if ok[k] else 'BAD'} {k} expected: {EXPECT[k]} | actual: {res[k]['status']} score={res[k]['score']} cm={res[k]['content_match']} flags={res[k]['flags']} lang={res[k]['language']}/{res[k]['gate']}")
print(f"\n{sum(ok.values())}/{len(ok)} voice cases as expected")
