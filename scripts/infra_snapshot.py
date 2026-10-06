"""Declared state of the cloud services, kept in the repository (Wave 9, read-only).

    python scripts/infra_snapshot.py            # rewrite infra/ from what is running now
    python scripts/infra_snapshot.py --check    # exit 1 if what is running differs from infra/

It only READS (describe / list / get-iam-policy). It records, per environment (production, staging, and
the dedicated runner project prooflab-runner-508214 with each service's invokers): every Cloud Run service and
job (image, identity, environment variable NAMES and non-secret values, secret references,
scaling, resources), Scheduler jobs and the Cloud Tasks queue. Secret VALUES are never read:
a secret appears only as the name it is mounted from. A change made by hand in the console
then shows up as a diff here instead of being discovered months later.
"""
import json, os, shutil, subprocess, sys

P, R = "prooflab-508214", "asia-south1"
RUNNER_PROJECT = "prooflab-runner-508214"     # dedicated code-runner project (6 Oct 2026): its own quota, no data, no secrets
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "infra")
G = shutil.which("gcloud") or shutil.which("gcloud.cmd")


def gcloud(*args, project=P):
    out = subprocess.run([G, *args, f"--project={project}", "--format=json"], capture_output=True, text=True)
    return json.loads(out.stdout) if out.returncode == 0 and out.stdout.strip() else []


def env_of(container):
    env = {}
    for e in container.get("env", []):
        ref = (e.get("valueFrom") or {}).get("secretKeyRef")
        env[e["name"]] = {"secret": ref["name"], "version": ref.get("key", "latest")} if ref else e.get("value", "")
    return dict(sorted(env.items()))


def service(s):
    t = s["spec"]["template"]
    c = t["spec"]["containers"][0]
    ann = t["metadata"].get("annotations", {})
    return {
        "image": c["image"],
        "service_account": t["spec"].get("serviceAccountName"),
        "ingress": s["metadata"].get("annotations", {}).get("run.googleapis.com/ingress"),
        "concurrency": t["spec"].get("containerConcurrency"),
        "timeout_seconds": t["spec"].get("timeoutSeconds"),
        "min_instances": ann.get("autoscaling.knative.dev/minScale"),
        "max_instances": ann.get("autoscaling.knative.dev/maxScale"),
        "cpu": c.get("resources", {}).get("limits", {}).get("cpu"),
        "memory": c.get("resources", {}).get("limits", {}).get("memory"),
        "execution_environment": ann.get("run.googleapis.com/execution-environment"),
        "cloudsql": ann.get("run.googleapis.com/cloudsql-instances"),
        "env": env_of(c),
        "volumes": sorted(v.get("name", "") for v in t["spec"].get("volumes", [])),
    }


def job(j):
    t = j["spec"]["template"]["spec"]["template"]["spec"]
    c = t["containers"][0]
    return {"image": c["image"], "service_account": t.get("serviceAccountName"),
            "timeout_seconds": t.get("timeoutSeconds"), "max_retries": t.get("maxRetries"),
            "cpu": c.get("resources", {}).get("limits", {}).get("cpu"),
            "memory": c.get("resources", {}).get("limits", {}).get("memory"), "env": env_of(c)}


def snapshot():
    state = {"production": {"services": {}, "jobs": {}}, "staging": {"services": {}, "jobs": {}}}
    for s in gcloud("run", "services", "list", f"--region={R}"):
        name = s["metadata"]["name"]
        state["staging" if "-staging-" in name else "production"]["services"][name] = service(s)
    for j in gcloud("run", "jobs", "list", f"--region={R}"):
        name = j["metadata"]["name"]
        state["staging" if "-staging-" in name else "production"]["jobs"][name] = job(j)
    sched = {}
    for j in gcloud("scheduler", "jobs", "list", f"--location={R}"):
        target = j.get("httpTarget", {})
        sched[j["name"].split("/")[-1]] = {
            "schedule": j.get("schedule"), "time_zone": j.get("timeZone"), "state": j.get("state"),
            "uri": target.get("uri"), "method": target.get("httpMethod"),
            "header_names": sorted((target.get("headers") or {}).keys()),      # names only: a header may carry a secret
            "oidc_service_account": (target.get("oidcToken") or {}).get("serviceAccountEmail"),
            "oauth_service_account": (target.get("oauthToken") or {}).get("serviceAccountEmail"),
        }
    # The dedicated runner project: services, plus who may invoke each (the privacy of the runner IS its IAM).
    state["runner"] = {"services": {}}
    for s in gcloud("run", "services", "list", f"--region={R}", project=RUNNER_PROJECT):
        name = s["metadata"]["name"]
        policy = gcloud("run", "services", "get-iam-policy", name, f"--region={R}", project=RUNNER_PROJECT) or {}
        state["runner"]["services"][name] = {**service(s), "invokers": sorted(
            m for b in policy.get("bindings", []) if b["role"] in ("roles/run.invoker", "roles/run.servicesInvoker") for m in b["members"])}
    queues = {q["name"].split("/")[-1]: {"rate": q.get("rateLimits"), "retry": q.get("retryConfig"), "state": q.get("state")}
              for q in gcloud("tasks", "queues", "list", f"--location={R}")}
    for env in ("production", "staging"):
        state[env]["scheduler"] = {k: v for k, v in sorted(sched.items()) if ("staging" in k) == (env == "staging")}
        state[env]["queues"] = {k: v for k, v in sorted(queues.items()) if ("staging" in k) == (env == "staging")}
    return state


def files(state):
    out = {}
    for env, kinds in state.items():
        for kind, items in kinds.items():
            out[os.path.join(env, f"{kind}.json")] = json.dumps(dict(sorted(items.items())), indent=1, sort_keys=True) + "\n"
    return out


if __name__ == "__main__":
    wanted = files(snapshot())
    if "--check" in sys.argv:
        drift = []
        for rel, text in wanted.items():
            path = os.path.join(ROOT, rel)
            have = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
            if have != text:
                a, b = json.loads(have or "{}"), json.loads(text)
                for name in sorted(set(a) | set(b)):
                    if a.get(name) != b.get(name):
                        keys = sorted(k for k in set(a.get(name) or {}) | set(b.get(name) or {})
                                      if (a.get(name) or {}).get(k) != (b.get(name) or {}).get(k))
                        drift.append(f"{rel}: {name} differs in {keys}")
        for d in drift:
            print("DRIFT:", d)
        print(f"{len(wanted)} files compared, {len(drift)} differences")
        sys.exit(1 if drift else 0)
    for rel, text in wanted.items():
        os.makedirs(os.path.dirname(os.path.join(ROOT, rel)), exist_ok=True)
        open(os.path.join(ROOT, rel), "w", encoding="utf-8", newline="\n").write(text)
    print("wrote", sorted(wanted))
