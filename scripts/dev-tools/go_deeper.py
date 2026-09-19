"""One-time: write a 'Go deeper' card for every lesson step (owner approved, 19 Sep 2026).
One DeepSeek call per topic; saved in level_content.go_deeper; re-runnable (skips done steps)."""
import json, re, subprocess, time, collections, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pl import token, http, API

KEY = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", "--secret=deepseek-api-key"],
                     capture_output=True, text=True, shell=True).stdout.strip()
assert KEY, "no DeepSeek key"
log = lambda *a: print(time.strftime("%H:%M:%S"), *a, flush=True)
usage = collections.Counter()

def S():
    return {"Authorization": f"Bearer {token('svc')}"}

def deepseek(prompt):
    body = json.dumps({"model": "deepseek-chat", "temperature": 0.5, "max_tokens": 8000,
                       "response_format": {"type": "json_object"},
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", body,
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=240) as r:
        j = json.loads(r.read())
    u = j.get("usage", {}); usage["in"] += u.get("prompt_tokens", 0); usage["out"] += u.get("completion_tokens", 0)
    return j["choices"][0]["message"]["content"], j["choices"][0].get("finish_reason")

PROMPT = """You help Indian engineering students (many below average, English as a second language) learn "{skill}" on the "{track}" path.
Below are the lesson steps they already read. For EACH step write a "Go deeper" card that makes it clearer and deeper:
- example: a worked example explained step by step in simple words (4 to 8 sentences). Concrete, real-life where possible.
- code: {code_rule}
- mistakes: 2 or 3 common mistakes beginners make on exactly this step, each one sentence saying the mistake AND the fix.
- try_this: one small practice task they can do in 5 to 10 minutes to check they understood (do not give the answer).
Plain English, short sentences, no greetings, do not repeat the lesson text word for word.

Steps:
{steps}

Return JSON only: {{"steps":[{{"sub_level":1,"example":"...","code":{{"language":"...","code":"..."}} or null,"mistakes":["..."],"try_this":"..."}}]}}"""

CODE_TRACKS = {"web-development", "mobile-development", "data-science", "machine-learning", "cloud-computing",
               "devops", "cybersecurity", "game-development", "blockchain", "iot", "robotics"}

def clean(s):
    ex = str(s.get("example") or "").strip()
    mis = [str(m).strip() for m in (s.get("mistakes") or []) if str(m).strip()][:3]
    tt = str(s.get("try_this") or "").strip()
    code = s.get("code")
    if isinstance(code, dict) and str(code.get("code") or "").strip():
        code = {"language": str(code.get("language") or "text")[:20], "code": str(code["code"])[:2500]}
    else:
        code = None
    if len(ex) < 80 or len(mis) < 2 or len(tt) < 20:
        return None
    return {"example": ex[:2500], "code": code, "mistakes": [m[:400] for m in mis], "try_this": tt[:600]}

def topic(item):
    (track, num), steps = item
    todo = [s for s in steps if not s["done"]]
    if not todo:
        return 0, 0
    code_rule = ('a short code example (max 20 lines) that shows the idea, or null if this step has no code'
                 if track in CODE_TRACKS else 'null')
    text = "\n\n".join(f"Step {s['sub_level']}: {s['title']}\n{s['explanation'][:1400]}" for s in todo)
    for attempt in range(2):
        try:
            out, finish = deepseek(PROMPT.format(skill=todo[0]["skill"], track=track, code_rule=code_rule, steps=text))
            data = json.loads(re.sub(r",\s*([}\]])", r"\1", out))
            got = {int(x.get("sub_level", -1)): clean(x) for x in data.get("steps", []) if isinstance(x, dict)}
            ok = 0
            for s in todo:
                card = got.get(s["sub_level"])
                if card:
                    st, _ = http(f"{API}/level_content?level_id=eq.{s['id']}", {"go_deeper": card},
                                 {**S(), "Prefer": "return=minimal"}, "PATCH")
                    ok += st < 300
            if ok == len(todo) or attempt == 1:
                log(f"{track} #{num} {todo[0]['skill']}: {ok}/{len(todo)} steps" + ("" if finish == "stop" else f" (finish={finish})"))
                return ok, len(todo) - ok
            todo = [s for s in todo if s["sub_level"] not in got or not got[s["sub_level"]]]
            text = "\n\n".join(f"Step {s['sub_level']}: {s['title']}\n{s['explanation'][:1400]}" for s in todo)
        except Exception as e:
            log(f"{track} #{num}: error {str(e)[:120]}")
            time.sleep(5)
    return 0, len(todo)

st, levels = http(f"{API}/levels?select=id,track_slug,level_number,sub_level,skill,title&kind=eq.explanation", headers=S(), method="GET")
st, content = http(f"{API}/level_content?select=level_id,explanation,go_deeper", headers=S(), method="GET")
cm = {c["level_id"]: c for c in content}
topics = collections.defaultdict(list)
for lv in sorted(levels, key=lambda x: x["sub_level"]):
    c = cm.get(lv["id"])
    if c:
        topics[(lv["track_slug"], lv["level_number"])].append({**lv, "explanation": c["explanation"] or "", "done": bool(c["go_deeper"])})
log(f"{len(topics)} topics, {sum(len(v) for v in topics.values())} steps, {sum(1 for v in topics.values() for s in v if s['done'])} already done")
with ThreadPoolExecutor(4) as ex:
    res = list(ex.map(topic, topics.items()))
log(f"DONE: {sum(r[0] for r in res)} written, {sum(r[1] for r in res)} failed; tokens in {usage['in']} out {usage['out']}")
