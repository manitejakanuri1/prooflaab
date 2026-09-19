"""Write every Track lesson and every Lot once, ahead of time (owner's request, 19 Sep 2026)."""
import json, time
from pl import token, http, API

F = "https://prooflab-functions-135298577404.asia-south1.run.app"
def S():
    return {"Authorization": f"Bearer {token('svc')}"}
log = lambda *a: print(time.strftime("%H:%M:%S"), *a, flush=True)

# 1. Lessons: every track, all levels, in small batches until nothing remains.
st, tracks = http(f"{API}/level_tracks?select=slug&order=sort_order", headers=S(), method="GET")
failed_total = 0
for t in tracks:
    slug = t["slug"]
    for attempt in range(40):
        st, out = http(f"{F}/levels-warm", {"track_slug": slug, "up_to_level": 99, "batch": 4},
                       {"Authorization": f"Bearer {token('admin')}"}, "POST")
        if st != 200:
            log(slug, "HTTP", st, str(out)[:150]); time.sleep(10); continue
        gen, fail, rem = out.get("generated", 0), out.get("failed", 0), out.get("remaining", 0)
        failed_total += fail
        log(f"{slug}: +{gen} written, {fail} failed, {rem} left", (out.get("details") or {}).get("failed") or "")
        if rem == 0 and fail == 0:
            break
        if gen == 0 and fail > 0 and rem <= fail:
            break  # only failures left; stop rather than pay again and again
st, lc = http(f"{API}/level_content?select=level_id", headers=S(), method="GET")
st, lv = http(f"{API}/levels?select=id", headers=S(), method="GET")
log(f"LESSONS DONE: {len(lc)} lesson rows written; failures seen: {failed_total}")

# 2. Lots: one per page that has none yet.
st, pages = http(f"{API}/source_content?select=id,title&hidden_at=is.null", headers=S(), method="GET")
st, have = http(f"{API}/lot_templates?select=source_content_id", headers=S(), method="GET")
done = {h["source_content_id"] for h in have if h["source_content_id"]}
todo = [p for p in pages if p["id"] not in done]
log(f"LOTS: {len(todo)} pages without a Lot")
for p in todo:
    st, out = http(f"{F}/lot-writer", {"source_content_id": p["id"]}, {"Authorization": f"Bearer {token('admin')}"}, "POST")
    log(f"lot for {str(p['title'])[:50]}: {st} {str(out)[:120]}")
st, have = http(f"{API}/lot_templates?select=source_content_id,sandbox_config_id,rubric_config_id", headers=S(), method="GET")
log(f"LOTS DONE: {sum(1 for h in have if h['source_content_id'])} pages have a Lot; "
    f"{sum(1 for h in have if h['sandbox_config_id'])} coding, {sum(1 for h in have if h['rubric_config_id'])} written")
