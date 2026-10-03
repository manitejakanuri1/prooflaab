"""STAGING ONLY. Service identity instead of shared secrets (G11 Scheduler, G12 code runner).

  G11  job endpoints accept Cloud Scheduler's own Google identity and nothing else:
       the old webhook secret, no credentials, a user's ticket, a real Google identity that
       is not the scheduler account, and the right account with the wrong audience are refused.
  G12  the code runner is private: Cloud Run IAM lets only the functions service account in,
       the runner checks the caller's name again, and no shared runner secret exists.
       Run still works for a student through the functions service.

    python scripts/dev-tools/staging_identity_check.py
"""
import json, os, subprocess, sys, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

P = "prooflab-508214"
RUNNER = "https://prooflab-staging-code-runner-ysn2mpe6sa-el.a.run.app"
S = "99999999-0001-0000-0000-000000000001"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:140], flush=True)


def post(url, headers, body=b"{}"):
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()[:160]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:160]


sh = lambda c: subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()
webhook = sh("gcloud secrets versions access latest --secret=prooflab-staging-webhook-secret")
me = sh("gcloud auth print-identity-token")                     # the operator: a real Google identity, not listed
wrong_aud = sh(f"gcloud auth print-identity-token --impersonate-service-account={st.SCHEDULER_SA} --audiences=https://example.invalid --include-email")

# ---- G11
for path in ("scheduled-job?job=prune-events", "transcription-reap"):
    url = f"{st.FUNCTIONS}/{path}"
    c, b = post(url, st.scheduler_headers())
    check(f"{path}: Cloud Scheduler's identity is accepted", c == 200, (c, b))
    c, b = post(url, {"x-webhook-secret": webhook})
    check(f"{path}: the old shared webhook secret is refused", c == 401, (c, b))
    c, b = post(url, {})
    check(f"{path}: no credentials refused", c == 401, (c, b))
    c, b = post(url, {"Authorization": f"Bearer {st.token(f'user:{S}')}"})
    check(f"{path}: a signed-in student refused", c == 401, (c, b))
    c, b = post(url, {"Authorization": f"Bearer {st.token('svc')}"})
    check(f"{path}: a service database token refused", c == 401, (c, b))
    if me:
        c, b = post(url, {"Authorization": f"Bearer {me}"})
        check(f"{path}: a real Google identity that is not the scheduler refused", c == 401, (c, b))
    if wrong_aud:
        c, b = post(url, {"Authorization": f"Bearer {wrong_aud}"})
        check(f"{path}: the scheduler identity minted for another audience refused", c == 401, (c, b))

job = json.loads(sh(f"gcloud scheduler jobs describe prooflab-staging-transcription-reap --location=asia-south1 --project={P} --format=json"))
target = job["httpTarget"]
check("the staging Scheduler job sends an identity token and no secret header",
      target.get("oidcToken", {}).get("serviceAccountEmail") == st.SCHEDULER_SA and "x-webhook-secret" not in (target.get("headers") or {}),
      list((target.get("headers") or {}).keys()))

# ---- G12
run_body = json.dumps({"language": "python", "code": "print(6*7)", "stdin": ""}).encode()
c, b = post(f"{RUNNER}/run", {}, run_body)
check("runner: no credentials refused by Cloud Run", c in (401, 403), c)
old = sh("gcloud secrets versions access latest --secret=prooflab-staging-code-runner-secret")
c, b = post(f"{RUNNER}/run", {"x-runner-secret": old}, run_body)
check("runner: the old shared runner secret no longer opens it", c in (401, 403), c)
if me:
    c, b = post(f"{RUNNER}/run", {"Authorization": f"Bearer {me}"}, run_body)
    check("runner: a real Google identity that is not the functions service refused", c in (401, 403), c)
c, b = st.call(f"user:{S}", "FN", "run-code", {"language": "python", "code": "print(6*7)"})
check("a student's Run still works through the functions service", c == 200 and b.get("stdout") == "42\n", (c, str(b)[:80]))
c, b = st.call(f"user:{S}", "FN", "run-sandbox", {"task_id": "e4e25563-6072-42a7-8c8a-79efce3bb649", "code": "print(1)"})
hidden_leak = "expected" in json.dumps([r for r in (b.get("results") or []) if r.get("hidden")]) if isinstance(b, dict) else True
check("Run on a task: visible tests only; hidden tests show no input or expected output", c == 200 and not hidden_leak, (c, str(b)[:110]))

iam = sh(f"gcloud run services get-iam-policy prooflab-staging-code-runner --region=asia-south1 --project={P} --format=json")
members = [m for bnd in json.loads(iam).get("bindings", []) if bnd["role"] == "roles/run.invoker" for m in bnd["members"]]
check("runner IAM: only the functions service account may invoke", members == [f"serviceAccount:prooflab-staging-functions@{P}.iam.gserviceaccount.com"], members)
for svc in ("functions", "code-runner"):
    env = sh(f'gcloud run services describe prooflab-staging-{svc} --region=asia-south1 --project={P} --format="value(spec.template.spec.containers[0].env)"')
    check(f"{svc}: no runner secret configured", "RUNNER_SECRET" not in env, "")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
