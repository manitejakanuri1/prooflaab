#!/usr/bin/env bash
set -Eeuo pipefail

P="prooflab-508214"
R="asia-south1"
DB="prooflab-staging-db"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
OUT="$ROOT/docs/teja-release/T11_STAGING_RELEASE_GATE.md"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$OUT" <<'REPORT'
# ProofLabAI — TEJA Staging Release Gate

Date: 2026-10-08

Environment: Staging only

Mode: Read-only inspection and local preparation.

## Already confirmed by T9

- Staging PostgreSQL RLS is enabled on user_roles, colleges and startups.
- Three historical self-registration policies were active at T9.
- schema_migrations records versions 95–98.
- Managed-account policy remediation is not yet applied.
- Cloud Run T9 execution completed successfully.

These historical findings do not replace post-migration verification.

## Staging Cloud Run Services
REPORT

echo ""
echo "========== CLOUD RUN INVENTORY =========="

gcloud run services list \
  --project="$P" \
  --region="$R" \
  --format=json > "$TMP/services.json"

python - "$TMP/services.json" <<'PY' > "$TMP/names.txt"
import json,sys
data=json.load(open(sys.argv[1],encoding="utf-8"))
names=set()

for x in data:
    raw=x.get("metadata",{}).get("name") or x.get("name","")
    name=raw.rsplit("/",1)[-1]
    if name.startswith("prooflab-staging-"):
        names.add(name)

for name in sorted(names):
    print(name)
PY

if [ ! -s "$TMP/names.txt" ]; then
  echo "BLOCKED: No staging services discovered"
  exit 1
fi

while IFS= read -r SERVICE; do
  SERVICE="${SERVICE%$'\r'}"

  if [[ ! "$SERVICE" =~ ^prooflab-staging-[a-z0-9]+(-[a-z0-9]+)*$ ]] || [ "${#SERVICE}" -gt 63 ]; then
    echo "BLOCKED: Invalid staging service name"
    exit 1
  fi

  echo "Inspecting: $SERVICE"

  gcloud run services describe "$SERVICE" \
    --project="$P" \
    --region="$R" \
    --format=json > "$TMP/service.json"

  python - "$TMP/service.json" "$SERVICE" <<'PY' >> "$OUT"
import json,sys

d=json.load(open(sys.argv[1],encoding="utf-8"))
name=sys.argv[2]

template=d.get("spec",{}).get("template",{})
containers=template.get("spec",{}).get("containers",[])

if not containers:
    containers=d.get("template",{}).get("containers",[])

env={}
for c in containers:
    for item in c.get("env",[]):
        env[item.get("name","")]=item

print(f"\n### {name}")
print(f"- Containers: {len(containers)}")

status=d.get("status",{})
latest=status.get("latestReadyRevisionName") or d.get("latestReadyRevision","unknown")
print(f"- Latest ready revision: {latest}")

traffic=status.get("traffic",[]) or d.get("traffic",[])

if traffic:
    for item in traffic:
        revision=item.get("revisionName") or item.get("revision","latest")
        percent=item.get("percent","unknown")
        print(f"- Traffic: {revision} = {percent}%")
else:
    print("- Traffic: not reported")

for key in ["SITE_URL","AUTH_BRIDGE_URL","POSTGREST_URL","SESSION_KEY"]:
    if key=="SITE_URL":
        if name not in (
            "prooflab-staging-accounts",
            "prooflab-staging-functions"
        ):
            continue

        value=env.get(key,{}).get("value")
        if value=="https://prooflab-staging.web.app":
            state="CORRECT"
        elif key not in env:
            state="MISSING - RELEASE BLOCKER"
        else:
            state="MISMATCH - REVIEW REQUIRED"

        print(f"- SITE_URL: {state}")
    elif key in env:
        source=env[key]
        backed="valueFrom" in source or "valueSource" in source
        print(f"- {key}: PRESENT ({'secret reference' if backed else 'configured; value hidden'})")

print("- Other environment values: redacted")
PY

done < "$TMP/names.txt"

echo ""
echo "========== 3. CLOUD SQL BACKUPS =========="

cat >> "$OUT" <<'REPORT'

## Recent Staging Database Backups

Backup presence is not proof that a restore has been tested.
REPORT

if gcloud sql backups list \
  --instance="$DB" \
  --project="$P" \
  --limit=5 \
  --format=json > "$TMP/backups.json"; then

  python - "$TMP/backups.json" <<'PY' >> "$OUT"
import json,sys
data=json.load(open(sys.argv[1],encoding="utf-8"))

if not data:
    print("- BLOCKED: No backup records returned")

for b in data:
    print(
        "- Status:",b.get("status","UNKNOWN"),
        "| Start:",b.get("startTime","UNKNOWN"),
        "| Type:",b.get("type","UNKNOWN")
    )
PY
else
  echo "- BLOCKED: Backup metadata unavailable" >> "$OUT"
fi

echo ""
echo "========== 4. DEPLOYMENT SOURCE CHECK =========="

cat >> "$OUT" <<'REPORT'

## Release Source Files
REPORT

for F in \
  ".github/workflows/deploy.yml" \
  "scripts/deploy-hosting.py" \
  "DEPLOYING.md" \
  "package.json" \
  "web-bff/Dockerfile"
do
  if [ -f "$ROOT/$F" ]; then
    echo "- PRESENT: $F" >> "$OUT"
  else
    echo "- MISSING: $F" >> "$OUT"
  fi
done

echo ""
echo "========== 5. RELEASE GATES =========="

cat >> "$OUT" <<'REPORT'

## Current Release Decisions

| Gate | State |
|---|---|
| T9 staging database inspection | PASS |
| Remove unsafe self-registration policies | BLOCKED — approved SQL migration required |
| Immediate suspended-session denial | BLOCKED — Claude repair pending |
| Managed-account migration validation | PENDING |
| Staging config alignment | Requires review of service inspection above |
| Unified staging build and deployment | NOT STARTED |
| Real Admin login | NOT PROVEN |
| Real College login | NOT PROVEN |
| Real Student login | NOT PROVEN |
| Real Company login | NOT PROVEN |
| Production release | NO-GO |

## Required Deployment Order

1. Review integrated release candidate and exact migrations.
2. Verify fresh staging backup and approved rollback procedure.
3. Apply only separately approved staging migrations.
4. Verify live RLS policies and application provisioning.
5. Update separately approved staging service configurations.
6. Deploy compatible backend and gateway revisions.
7. Deploy staging Firebase Hosting with correct API routing.
8. Run live four-role, authorization and recovery tests.
9. Review evidence before any production release.

## Safety Record

No deployment, SQL modification, Cloud Run traffic update,
IAM change, Git commit, Git push or production change
was requested by this script.
REPORT

echo ""
echo "========== T11 REPORT =========="
cat "$OUT"

echo ""
echo "T11 REPORT SAVED:"
echo "$OUT"
