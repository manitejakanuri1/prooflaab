"""python scripts/test_deno_env_allowlist.py - exits non-zero on failure.

A Deno service started with --allow-env=A,B,... crashes at start ("NotCapable: Requires env access to X") the moment
its code reads a setting that is not on that list. On 13 Oct 2026 the staging canaries of auth-bridge and files
failed exactly so (IDENTITY_PROJECT, POSTGREST_URL). This reads every Dockerfile with an --allow-env list and checks
each Deno.env.get('NAME') in that service's own non-test sources.
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
problems, checked = [], 0
for dockerfile in glob.glob(os.path.join(ROOT, "*", "Dockerfile")):
    text = open(dockerfile, encoding="utf-8").read()
    m = re.search(r"--allow-env=([A-Z0-9_,]+)", text)
    if not m:
        continue
    allowed = set(m.group(1).split(","))
    folder = os.path.dirname(dockerfile)
    copied = re.findall(r"^COPY\s+(.+?)\s+\./\s*$", text, re.M)
    files = [f for line in copied for f in line.split() if f.endswith(".ts")] or \
            [os.path.basename(p) for p in glob.glob(os.path.join(folder, "*.ts"))]
    for name in files:
        if "test" in name:
            continue
        src = open(os.path.join(folder, name), encoding="utf-8").read()
        for var in re.findall(r"Deno\.env\.get\(\s*['\"]([A-Z0-9_]+)['\"]", src):
            checked += 1
            if var not in allowed:
                problems.append(f"{os.path.basename(folder)}/{name} reads {var}, not in its Dockerfile --allow-env")
for p in problems:
    print("PROBLEM:", p)
print(f"deno env allow-list: {checked} reads checked, {len(problems)} problems")
sys.exit(1 if problems else 0)
