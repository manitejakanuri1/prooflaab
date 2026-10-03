"""STAGING ONLY. The crawler's whole journey, for real (G3):

  approved source -> job authenticates through the signer -> fetch -> provenance ->
  source_content -> second run does not duplicate -> the page is platform material (any
  college) while college material stays private -> a Lot is written from it and passes the
  wording contract -> it has a real evaluator -> a student gets it.

The source is an openly licensed page (CC BY-SA 4.0): "The Art of Command Line" by Joshua Levy.
One AI call writes the Lot (a few paise). Safe to re-run: the Lot step is skipped when the
page already has one.

    python scripts/dev-tools/staging_crawler_e2e.py
"""
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

P, R = "prooflab-508214", "asia-south1"
SEED = "https://github.com/jlevy/the-art-of-command-line"
SOURCE_ID = "99999999-0004-0000-0000-00000000c0de"
STUDENT_A = "99999999-0001-0000-0000-000000000004"      # College A fixture
STUDENT_B = "3d99656a-950f-4bb8-ab75-e97317e68542"      # College B fixture
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:170], flush=True)


def sql(text):
    f = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8", newline="\n")
    f.write(text.rstrip() + "\n"); f.close()
    r = subprocess.run(["bash", "scripts/dev-tools/staging_sql.sh", f.name.replace("\\", "/")], capture_output=True, text=True)
    assert "exit=0" in r.stdout, r.stdout[-400:]


def run_crawler():
    subprocess.run(f"gcloud run jobs execute prooflab-staging-crawler --project={P} --region={R} --wait", shell=True, capture_output=True, text=True)
    ex = subprocess.run(f'gcloud run jobs executions list --job=prooflab-staging-crawler --region={R} --project={P} --limit=1 --format="value(metadata.name,status.succeededCount)"',
                        shell=True, capture_output=True, text=True).stdout.split()
    time.sleep(20)
    log = subprocess.run(f'gcloud logging read "resource.type=cloud_run_job AND labels.\\"run.googleapis.com/execution_name\\"={ex[0]}" --project={P} --freshness=20m --format="value(textPayload)" --order=asc',
                         shell=True, capture_output=True, text=True).stdout
    return (len(ex) > 1 and ex[1] == "1"), log


sql(f"""insert into public.source_registry (id, domain, name, seed_urls, rights_flag, rate_limit_per_min, max_depth, license_note)
values ('{SOURCE_ID}', 'github.com', 'The Art of Command Line (staging crawler check)', array['{SEED}'], 'APPROVED_SOURCE', 30, 1,
        'CC BY-SA 4.0 - Joshua Levy and contributors')
on conflict (id) do update set seed_urls = excluded.seed_urls, rights_flag = 'APPROVED_SOURCE', retired_at = null;""")

before = st.call("svc", "GET", f"source_content?select=id&source_id=eq.{SOURCE_ID}")[1]
ok, log = run_crawler()
summary = next((l for l in log.splitlines() if l.startswith("CRAWLER SUMMARY")), "")
check("crawler job ran to the end and exited cleanly", ok and summary, summary or log[-200:])
check("it reached the database through the signer (no shared key)", "prooflab-staging-api" in log and "PGRST_JWT_SECRET" not in log, [l for l in log.splitlines() if "writing to" in l][:1])
tokens = subprocess.run(f'gcloud logging read "resource.labels.service_name=prooflab-staging-auth-bridge AND textPayload:\\"service token issued to prooflab-staging-crawler\\"" --project={P} --freshness=20m --limit=1 --format="value(textPayload)"',
                        shell=True, capture_output=True, text=True).stdout.strip()
check("the signer issued its token to the crawler's own identity", bool(tokens), tokens)

rows = st.call("svc", "GET", f"source_content?select=id,url,canonical_url,title,content_hash,simhash,fetch_method,rights_flag,visibility,submitted_by_college_id,fetched_at,markdown&source_id=eq.{SOURCE_ID}")[1]
page = rows[0] if rows else {}
check("the page is stored with its provenance", len(rows) == 1 and page.get("url") == SEED and page.get("fetch_method") and page.get("content_hash")
      and page.get("rights_flag") == "APPROVED_SOURCE" and len(page.get("markdown") or "") > 2000,
      {k: page.get(k) for k in ("url", "fetch_method", "rights_flag", "visibility")} | {"chars": len(page.get("markdown") or "")})
check("crawled material is platform material, not tied to a college", page.get("visibility") == "platform" and page.get("submitted_by_college_id") is None, page.get("visibility"))

ok2, log2 = run_crawler()
rows2 = st.call("svc", "GET", f"source_content?select=id&source_id=eq.{SOURCE_ID}")[1]
s2 = next((l for l in log2.splitlines() if l.startswith("CRAWLER SUMMARY")), "")
check("a second run does not store the page twice", ok2 and len(rows2) == 1 and ("unchanged=1" in s2 or "updated=1" in s2), s2)

# College material stays private while crawled material is shared (migration 58).
c, a_src = st.call("svc", "RPC", "next_lot_source", {"_student_id": STUDENT_A})
c, b_src = st.call("svc", "RPC", "next_lot_source", {"_student_id": STUDENT_B})
college_pages = {r["id"] for r in st.call("svc", "GET", "source_content?select=id,submitted_by_college_id&visibility=eq.college")[1]
                 if r["submitted_by_college_id"] != "e41e3152-efe6-4c32-93ef-fd4fde74fd07"}
check("a student of another college is never offered a college's private page", b_src not in college_pages, b_src)

# Write the Lot from the crawled page (the nightly pre-generation job), then check it.
has = st.call("svc", "GET", f"lot_templates?select=id&source_content_id=eq.{page.get('id')}&origin=eq.ai")[1]
if not has:
    req = urllib.request.Request(f"{st.FUNCTIONS}/scheduled-job?job=pregenerate-lots", data=json.dumps({"source_content_ids": [page.get("id")]}).encode(),
                                 method="POST", headers=st.scheduler_headers())
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            print("   pregenerate:", r.read().decode()[:260])
    except urllib.error.HTTPError as e:
        print("   pregenerate:", e.code, e.read().decode()[:200])
tmpl = st.call("svc", "GET", f"lot_templates?select=id,title,scenario,origin,sandbox_config_id,rubric_config_id&source_content_id=eq.{page.get('id')}")[1]
t = tmpl[0] if tmpl else {}
scenario = t.get("scenario") or ""
check("a Lot was written from the crawled page", t.get("origin") == "ai" and len(scenario) > 200, (t.get("title"), len(scenario)))
check("the Lot follows the wording contract (context, 'Your task:', what to produce)",
      "Your task:" in scenario and ("What to write:" in scenario or "Input" in scenario), scenario[:120].replace("\n", " "))
check("the Lot has a real evaluator of exactly one kind", bool(t.get("sandbox_config_id")) != bool(t.get("rubric_config_id")),
      {"sandbox": bool(t.get("sandbox_config_id")), "rubric": bool(t.get("rubric_config_id"))})
if t.get("rubric_config_id"):
    rub = st.call("svc", "GET", f"task_rubric_config?select=is_generic_fallback,criteria&id=eq.{t['rubric_config_id']}")[1][0]
    check("written Lot: its own rubric, not the generic checklist", rub["is_generic_fallback"] is False and len(rub["criteria"]) >= 3, len(rub["criteria"]))
else:
    tests = st.call("svc", "GET", f"task_sandbox_config?select=test_cases&id=eq.{t.get('sandbox_config_id')}")[1][0]["test_cases"]
    check("coding Lot: real tests, some hidden", len(tests) >= 4 and any(not x.get("visible", True) for x in tests), len(tests))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
