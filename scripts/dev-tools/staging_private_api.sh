#!/usr/bin/env bash
# TEST website only (MF-001): make the TEST database API (prooflab-staging-api) reachable only from our own
# programs, over Google's private network. Nothing here touches a REAL-website (prooflab-*) service.
#
# Run one step at a time, in this order, and let the tests run between steps:
#   bash scripts/dev-tools/staging_private_api.sh network        # private Google access + NAT (outside calls keep working)
#   bash scripts/dev-tools/staging_private_api.sh dns            # *.run.app -> Google's private IPv4 addresses inside the VPC
#   bash scripts/dev-tools/staging_private_api.sh move <name>    # one program onto the private road, e.g. move web-bff
#   bash scripts/dev-tools/staging_private_api.sh private        # LAST: the database API accepts private traffic only
#
# Undo (any time, in reverse order):
#   bash scripts/dev-tools/staging_private_api.sh undo-private   # database API open again (ingress all)
#   bash scripts/dev-tools/staging_private_api.sh undo-move <name> [old version printed by move]
#   bash scripts/dev-tools/staging_private_api.sh undo-dns
#   bash scripts/dev-tools/staging_private_api.sh undo-network   # removes NAT + router, turns private access off
#
# Programs that call the database API: web-bff auth-bridge accounts files functions transcription-worker
# (services) and crawler bug-finder (jobs).
# Why the dns step: run.app names also have IPv6 addresses. Deno programs (web-bff, auth-bridge, files, functions)
# prefer IPv6, and Direct VPC egress on an IPv4-only subnet sends IPv6 straight to the internet, so their calls
# skipped the private road (seen 28 Oct 2026: files still called the API from a public IPv6 address after moving).
# A private zone for run.app answers only private.googleapis.com's IPv4 addresses inside the VPC.
# move sets VPC_MOVED_AT so every move starts fresh instances (old ones keep open IPv6 connections).
set -euo pipefail
P=prooflab-508214
R=asia-south1
SERVICES="web-bff auth-bridge accounts files functions transcription-worker"
JOBS="crawler bug-finder"

kind() {
  case " $SERVICES " in *" $1 "*) echo services; return;; esac
  case " $JOBS " in *" $1 "*) echo jobs; return;; esac
  echo "unknown program: $1 (one of: $SERVICES $JOBS)" >&2; exit 1
}

case "${1:-}" in
  network)
    gcloud compute networks subnets update default --region=$R --project=$P --enable-private-ip-google-access
    gcloud compute routers create prooflab-staging-router --network=default --region=$R --project=$P
    gcloud compute routers nats create prooflab-staging-nat --router=prooflab-staging-router --region=$R --project=$P \
      --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
    echo "NETWORK READY"
    ;;
  dns)
    gcloud services enable dns.googleapis.com --project=$P
    gcloud dns managed-zones create prooflab-staging-run-app --project=$P --dns-name=run.app.       --visibility=private --networks=default --description="TEST: run.app over private Google access (MF-001)"
    gcloud dns record-sets create "*.run.app." --zone=prooflab-staging-run-app --project=$P --type=A --ttl=300       --rrdatas=199.36.153.8,199.36.153.9,199.36.153.10,199.36.153.11
    echo "DNS READY"
    ;;
  undo-dns)
    gcloud dns record-sets delete "*.run.app." --zone=prooflab-staging-run-app --project=$P --type=A
    gcloud dns managed-zones delete prooflab-staging-run-app --project=$P
    echo "DNS UNDONE"
    ;;
  move)
    k=$(kind "${2:?program name}")
    old=""
    [ "$k" = services ] && old=$(gcloud run services describe "prooflab-staging-$2" --region=$R --project=$P       --format=json | python -c "import json,sys; print(next(t['revisionName'] for t in json.load(sys.stdin)['status']['traffic'] if t.get('percent')==100))")
    gcloud run $k update "prooflab-staging-$2" --region=$R --project=$P       --network=default --subnet=default --vpc-egress=all-traffic --update-env-vars=VPC_MOVED_AT=$(date +%s)
    if [ "$k" = services ]; then
      # Some TEST services serve a pinned version; send all traffic to the version just made.
      new=$(gcloud run services describe "prooflab-staging-$2" --region=$R --project=$P         --format='value(status.latestCreatedRevisionName)')
      gcloud run services update-traffic "prooflab-staging-$2" --region=$R --project=$P --to-revisions="$new=100"
      echo "MOVED $2: now serving $new (was $old)"
      echo "UNDO: bash scripts/dev-tools/staging_private_api.sh undo-move $2 $old"
    else
      echo "MOVED $2"
    fi
    ;;
  private)
    gcloud run services update prooflab-staging-api --region=$R --project=$P --ingress=internal
    echo "API PRIVATE"
    ;;
  undo-private)
    gcloud run services update prooflab-staging-api --region=$R --project=$P --ingress=all
    echo "API OPEN AGAIN"
    ;;
  undo-move)
    k=$(kind "${2:?program name}")
    if [ "$k" = services ] && [ -n "${3:-}" ]; then
      gcloud run services update-traffic "prooflab-staging-$2" --region=$R --project=$P --to-revisions="$3=100"
    else
      gcloud run $k update "prooflab-staging-$2" --region=$R --project=$P --clear-network
    fi
    echo "UNDONE MOVE $2"
    ;;
  undo-network)
    gcloud compute routers nats delete prooflab-staging-nat --router=prooflab-staging-router --region=$R --project=$P --quiet
    gcloud compute routers delete prooflab-staging-router --region=$R --project=$P --quiet
    gcloud compute networks subnets update default --region=$R --project=$P --no-enable-private-ip-google-access
    echo "NETWORK UNDONE"
    ;;
  *)
    sed -n '2,24p' "$0"; exit 1;;
esac
