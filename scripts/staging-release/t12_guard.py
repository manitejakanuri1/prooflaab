import argparse
import sys

p = argparse.ArgumentParser()
p.add_argument("--project", required=True)
p.add_argument("--region", required=True)
p.add_argument("--bff", required=True)
p.add_argument("--site-url", required=True)
p.add_argument("--apply", action="store_true")
a = p.parse_args()

expected = {
    "project": "prooflab-508214",
    "region": "asia-south1",
    "bff": "prooflab-staging-web-bff",
    "site_url": "https://prooflab-staging.web.app",
}
actual = {
    "project": a.project,
    "region": a.region,
    "bff": a.bff,
    "site_url": a.site_url,
}

if a.apply:
    sys.exit("BLOCKED: This tooling never performs deployments")

bad = [k for k in expected if actual[k] != expected[k]]
if bad:
    for k in bad:
        print(f"BLOCKED: {k} mismatch")
    sys.exit(2)

print("PASS: Staging-only inputs")
print("PASS: Expected staging BFF target")
print("PASS: Expected staging site origin")
print("DRY RUN ONLY - No external changes")
