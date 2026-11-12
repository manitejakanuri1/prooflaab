"""STAGING ONLY. One-time (owner approved 12 Nov 2026, budget Rs 2-5, hard stop Rs 10): pick a skill for live bank
questions that the free rules (migration 331) could not tag. DeepSeek, 25 questions per call, picks ONLY from
skill_vocab or "none". Writes nothing to the bank: it saves picks to a JSON file (a migration applies them) and
one llm_usage insert per call (feature 'bank-skill-tag') to <out>.usage.sql, run with sq.sh. The staging API is
private, so the input comes from the SQL runner too:
  {"vocab": [...], "rows": [{"id", "question", "topic", "title"}]}   (staging_sql.sh, json_build_object)

    python scripts/dev-tools/ai_tag_bank_skills.py questions.json out.json [limit]   # limit=5 for the dry run
"""
import json, os, subprocess, sys, urllib.request

IN_RS_PER_M, OUT_RS_PER_M, HARD_STOP_RS = 23.0, 92.0, 10.0   # same price table as staging_ai_spend.py
src = json.load(open(sys.argv[1]))
out_path = sys.argv[2]
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
KEY = subprocess.run("gcloud secrets versions access latest --secret=deepseek-api-key",
                     shell=True, capture_output=True, text=True).stdout.strip()
assert KEY, "no DeepSeek key"

vocab, rows = src["vocab"], src["rows"][:limit]
done = json.load(open(out_path)) if os.path.exists(out_path) else {}
todo = [r for r in rows if r["id"] not in done]
print(f"{len(rows)} untagged, {len(todo)} to ask")

PROMPT = """Each line below is one practice question for engineering students (with its topic and page title).
For each, pick the ONE skill from this fixed list that the question mainly tests, or "none" if no skill on the list fits well:
{vocab}
Use "none" for career advice, interviews, behaviour, ethics or general tools unless a listed skill clearly fits.
Return ONLY JSON: {{"picks": {{"<number>": "<skill or none>", ...}}}}

{lines}"""

spent = 0.0
for i in range(0, len(todo), 25):
    batch = todo[i:i + 25]
    lines = "\n".join(f'{n}. [{(b.get("topic") or "")[:60]} | {b.get("title") or ""}] '
                      f'{b["question"][:300]}' for n, b in enumerate(batch, 1))
    body = json.dumps({"model": "deepseek-chat", "temperature": 0, "max_tokens": 1200,
                       "response_format": {"type": "json_object"},
                       "messages": [{"role": "user", "content": PROMPT.format(vocab=", ".join(vocab), lines=lines)}]}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", body,
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        j = json.loads(r.read())
    u = j.get("usage", {})
    pin, pout = u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
    with open(out_path + ".usage.sql", "a") as f:
        f.write("insert into public.llm_usage (feature, provider, model, prompt_tokens, completion_tokens, total_tokens, truncated) "
                f"values ('bank-skill-tag', 'deepseek', 'deepseek-chat', {pin}, {pout}, {pin + pout}, "
                f"{str(j['choices'][0].get('finish_reason') == 'length').lower()});\n")
    spent += pin / 1e6 * IN_RS_PER_M + pout / 1e6 * OUT_RS_PER_M
    picks = json.loads(j["choices"][0]["message"]["content"]).get("picks", {})
    for n, b in enumerate(batch, 1):
        p = str(picks.get(str(n), "none")).strip()
        done[b["id"]] = p if p in vocab else None   # anything off the list counts as "none"
    json.dump(done, open(out_path, "w"), indent=1)
    print(f"batch {i // 25 + 1}: in={pin} out={pout} ~Rs {spent:.3f}", flush=True)
    if spent >= HARD_STOP_RS:
        sys.exit(f"HARD STOP at ~Rs {spent:.2f}")

for b in todo[:10] if limit <= 10 else []:
    print(f'{done[b["id"]]!s:18} <- {b["question"][:110]}')
print(f"picked: {sum(1 for v in done.values() if v)} / {len(done)}; none: {sum(1 for v in done.values() if not v)}; ~Rs {spent:.3f}")
