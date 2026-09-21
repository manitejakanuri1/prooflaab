"""Write every unwritten topic, once (the one-time course batch). Safe to re-run: written topics are skipped.
usage: python warm_all.py [track ...]   6 tracks at a time; stops a track when only failures are left."""
import sys, time, threading
from concurrent.futures import ThreadPoolExecutor
from pl import token, http, API

F = "https://prooflab-functions-135298577404.asia-south1.run.app"
lock = threading.Lock()
def log(*a):
    with lock:
        print(time.strftime("%H:%M:%S"), *a, flush=True)

_tok = {"t": None, "at": 0}
def admin_token():                          # one sign-in per 8 minutes: Firebase limits password checks
    with lock:
        if time.time() - _tok["at"] > 480 or not _tok["t"]:
            _tok["t"], _tok["at"] = token("admin"), time.time()
        return _tok["t"]

def warm(slug):
    gen_total = fail_total = 0
    for _ in range(200):
        try:
            st, out = http(f"{F}/levels-warm", {"track_slug": slug, "up_to_level": 999, "batch": 2},
                           {"Authorization": f"Bearer {admin_token()}"}, "POST")
        except Exception as e:
            log(slug, "error", str(e)[:100]); time.sleep(30); continue
        if st != 200:
            log(slug, "HTTP", st, str(out)[:120]); time.sleep(15); continue
        gen, fail, rem = out.get("generated", 0), out.get("failed", 0), out.get("remaining", 0)
        gen_total += gen; fail_total += fail
        log(f"{slug}: +{gen} written, {fail} failed, {rem} left")
        if rem == 0 and fail == 0 or (gen == 0 and fail > 0 and rem <= fail):
            break
    return slug, gen_total, fail_total

if __name__ == "__main__":
    tracks = sys.argv[1:] or [t["slug"] for t in http(f"{API}/level_tracks?select=slug&order=sort_order",
                                                     headers={"Authorization": f"Bearer {token('svc')}"}, method="GET")[1]]
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(warm, tracks))
    print("DONE", res)
