"""Is CI green for the commit being released? The CI gate holds what cannot run on a laptop:
the code-runner container suite (22 checks: isolation, memory, no internet, leftover
processes) and the build-once artifact hand-off on a separate machine.

    python scripts/dev-tools/ci_green_check.py
"""
import json, subprocess, sys

sha = subprocess.run("git rev-parse HEAD", shell=True, capture_output=True, text=True).stdout.strip()
runs = json.loads(subprocess.run(
    f"gh run list --repo manitejakanuri1/prooflaab --commit {sha} --json databaseId,status,conclusion --limit 1",
    shell=True, capture_output=True, text=True).stdout or "[]")
if not runs:
    print(f"no CI run for {sha[:7]} (push the commit first)"); sys.exit(1)
run = runs[0]
jobs = json.loads(subprocess.run(
    f"gh run view --repo manitejakanuri1/prooflaab {run['databaseId']} --json jobs", shell=True, capture_output=True, text=True).stdout)["jobs"]
state = {j["name"]: j["conclusion"] or j["status"] for j in jobs}
print(f"commit {sha[:7]} run {run['databaseId']}: {state}")
need = ("test", "code-runner", "artifact-handoff")
ok = all(state.get(n) == "success" for n in need) and state.get("deploy") in ("skipped", None)
print(f"{sum(state.get(n) == 'success' for n in need)}/{len(need)} checks passed" + ("" if ok else "  (deploy must be skipped on a branch)"))
sys.exit(0 if ok else 1)
