"""STAGING ONLY. Runs the real bug-finder job in its plumbing mode (G4): the container starts,
the browser starts, the job gets its database token from the signer with its own identity,
stores its result and exits cleanly. No site is opened and no login is used - staging has no
logins (it shares production's login pool), so the sign-in journeys run in production only.

    python scripts/dev-tools/staging_bugfinder_check.py
"""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

P, R = "prooflab-508214", "asia-south1"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:150], flush=True)


before = st.call("svc", "GET", "bug_finder_runs?select=run_id&order=created_at.desc&limit=1")[1]
subprocess.run(f"gcloud run jobs execute prooflab-staging-bug-finder --project={P} --region={R} --wait", shell=True, capture_output=True, text=True)
ex = subprocess.run(f'gcloud run jobs executions list --job=prooflab-staging-bug-finder --region={R} --project={P} --limit=1 --format="value(metadata.name,status.succeededCount,status.failedCount)"',
                    shell=True, capture_output=True, text=True).stdout.split()
check("the job ran and exited cleanly", len(ex) > 1 and ex[1] == "1", ex)
time.sleep(5)
rows = st.call("svc", "GET", "bug_finder_runs?select=run_id,step,ok&order=created_at.desc&limit=3")[1]
fresh = rows and (not before or rows[0]["run_id"] != before[0]["run_id"])
check("it stored its result in the staging database", fresh and len({r["run_id"] for r in rows}) == 1 and len(rows) == 3, [(r["step"], r["ok"]) for r in rows])
check("every step passed", fresh and all(r["ok"] for r in rows))
env = subprocess.run(f'gcloud run jobs describe prooflab-staging-bug-finder --project={P} --region={R} --format="value(spec.template.spec.template.spec.containers[0].env)"',
                     shell=True, capture_output=True, text=True).stdout
check("no production address, login or shared signing key in the job", "prooflab.co.in" not in env and "PASSWORD" not in env and "PGRST_JWT_SECRET" not in env and "prooflab-staging-api" in env)
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
