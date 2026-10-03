"""Indian-English transcription benchmark (Phase J). STATUS: WAITING_FOR_REAL_AUDIO.

The voice pipeline works today; this measures how WELL it hears Indian English, and compares
the current model with a candidate. It needs real recordings made with consent - it must not be
run on synthetic (text-to-speech) audio, which says nothing about real accents.

Prepare a folder:
    samples/
      001.webm   001.txt     <- the recording and exactly what was said (typed by a person)
      002.m4a    002.txt
      ...                      20-30 recordings, 30-60 s each, different speakers
      technical_words.txt    <- optional: one term per line (python, dictionary, sql, loop ...)

Run (staging transcribers only; a ticket for a staging fixture is minted for you):
    python scripts/dev-tools/whisper_benchmark.py samples \
        --current   https://prooflab-staging-transcriber-ysn2mpe6sa-el.a.run.app \
        --candidate https://<a second staging transcriber deployed with WHISPER_MODEL=small>

Reports, per model: word error rate (WER), technical-word accuracy, how many recordings the
English gate accepted, latency per recording and per second of audio. Memory and cost come from
the Cloud Run revision (2 vCPU / 2 GiB today): add the peak memory from the console.
Results are written to e2e-out/whisper_benchmark.json. Nothing is stored in the database.
"""
import argparse, json, os, re, statistics, sys, time, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(__file__))

TYPES = {".webm": "audio/webm", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg"}


def words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def wer(reference, hypothesis):
    """Word error rate: (substitutions + deletions + insertions) / reference words."""
    r, h = words(reference), words(hypothesis)
    if not r:
        return 0.0 if not h else 1.0
    prev = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i] + [0] * len(h)
        for j, hw in enumerate(h, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rw != hw))
        prev = cur
    return prev[-1] / len(r)


def technical_accuracy(reference, hypothesis, terms):
    said = [t for t in terms if t in words(reference)]
    if not said:
        return None
    heard = set(words(hypothesis))
    return sum(t in heard for t in said) / len(said)


def transcribe(url, path, token):
    data = open(path, "rb").read()
    req = urllib.request.Request(f"{url.rstrip('/')}/transcribe", data=data, method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": TYPES[os.path.splitext(path)[1].lower()]})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read()), time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:120]}"}, time.perf_counter() - t0


def run(label, url, samples, terms, token):
    rows = []
    for audio, ref in samples:
        out, secs = transcribe(url, audio, token)
        meta = out.get("language_meta") or {}
        rows.append({"file": os.path.basename(audio), "seconds": round(secs, 2), "audio_seconds": out.get("duration"),
                     "gate": meta.get("gate"), "language": meta.get("language"), "error": out.get("error"),
                     "wer": None if out.get("error") or out.get("non_english") else round(wer(ref, out.get("text", "")), 4),
                     "technical": None if out.get("error") else technical_accuracy(ref, out.get("text", ""), terms)})
    scored = [r for r in rows if r["wer"] is not None]
    tech = [r["technical"] for r in rows if r["technical"] is not None]
    return {"model": label, "url": url, "recordings": len(rows), "transcribed": len(scored),
            "refused_as_not_english": sum(r["gate"] == "non_english" for r in rows),      # must be 0 for English speakers
            "errors": sum(bool(r["error"]) for r in rows),
            "wer_mean": round(statistics.mean(r["wer"] for r in scored), 4) if scored else None,
            "wer_worst": max((r["wer"] for r in scored), default=None),
            "technical_word_accuracy": round(statistics.mean(tech), 4) if tech else None,
            "seconds_per_recording_median": round(statistics.median(r["seconds"] for r in rows), 2) if rows else None,
            "realtime_factor": round(sum(r["seconds"] for r in scored) / max(sum(r["audio_seconds"] or 0 for r in scored), 1e-9), 3) if scored else None,
            "rows": rows}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("folder"); ap.add_argument("--current", required=True); ap.add_argument("--candidate")
    a = ap.parse_args()
    samples = []
    for f in sorted(os.listdir(a.folder)):
        base, ext = os.path.splitext(f)
        if ext.lower() in TYPES and os.path.exists(os.path.join(a.folder, base + ".txt")):
            samples.append((os.path.join(a.folder, f), open(os.path.join(a.folder, base + ".txt"), encoding="utf-8").read()))
    if len(samples) < 20:
        sys.exit(f"WAITING_FOR_REAL_AUDIO: found {len(samples)} recording+transcript pairs in {a.folder}; the benchmark needs at least 20 real, consented recordings.")
    terms_file = os.path.join(a.folder, "technical_words.txt")
    terms = [t.strip().lower() for t in open(terms_file, encoding="utf-8")] if os.path.exists(terms_file) else \
        ["python", "java", "sql", "loop", "function", "dictionary", "list", "array", "variable", "database", "query", "index", "string", "class", "api"]
    import st
    token = st.token("user:99999999-0001-0000-0000-000000000001", ttl=3000)
    report = [run("current", a.current, samples, terms, token)] + ([run("candidate", a.candidate, samples, terms, token)] if a.candidate else [])
    for r in report:
        print({k: v for k, v in r.items() if k != "rows"})
    os.makedirs("e2e-out", exist_ok=True)
    json.dump(report, open("e2e-out/whisper_benchmark.json", "w"), indent=1)
    print("written: e2e-out/whisper_benchmark.json")
