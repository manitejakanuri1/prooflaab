"""Keeps the retired architecture from coming back (release gate + CI).

    python scripts/legacy_guard.py            # exit 1 if a retired identifier is in ACTIVE source
    python scripts/legacy_guard.py --report   # counts per term: active / allowed / historical

ProofLab has one evidence model: task_submissions + voice_explanations + resume assessments.
Proof upload, Trust score, cosigns, conceptual verification and the old proof-review flows are
retired. This scans every tracked file of ACTIVE source for their identifiers.

Not active source (never scanned): migration history, rollback files and documents - they
describe what happened and must not be rewritten. Everything else is active unless a line in
ALLOW says exactly why a file may still contain a term.
"""
import re, subprocess, sys

TERMS = [
    # tables / columns
    "proof_uploads", "proof_id", "trust_score", "trust_scores", "cosigns", "conceptual_tests",
    "conceptual_answer_keys", "proof_appeals", "reflection_requests", "ai_verifications",
    "github_verifications", "coding_streaks", "recruiter_links", "recruiter_link_views",
    # database functions
    "cosign_proof", "cosignable_proofs", "my_cosigns", "set_proof_publicity", "activity_from_proof",
    "on_proof_change", "on_proof_reviewed",
    # server functions (slugs)
    "verify-proof", "trust-compute", "question-generator", "response-evaluator",
    "submit-conceptual-answers", "proof-file-url", "ai-authorship", "github-check", "leetcode-streak-sync",
    # screens, hooks, routes
    "ReviewProofs", "ProofSubmissionsContent", "TrustXPModeration", "useProofUploads", "useProofAppeals",
    "useConceptualTests", "useReflectionRequest", "StudentUploadsPage", "StudentCosigns", "CodingStreaks",
    "RecruiterView", "review-proofs", "useTaskApplications", "StartupPostTaskPage", "task_applications",
]

# History and documents: describe the past, never scanned.
HISTORICAL = re.compile(r"^(migration/|supabase/migrations/|supabase/tests/|docs/|infra/|scripts/dev-tools/step6|.*\.md$)")

# Active files that may contain a term, each with the reason. Keep this list short.
ALLOW = {
    "scripts/legacy_guard.py": "this guard: the list of retired names",
    "scripts/rpc_manifest.json": "legacy_until_66: names the four old-site functions production keeps until Stage 7 / migration 66, so the permission gate can check them",
    "src/integrations/supabase/types.ts": "GENERATED from the production schema, which still has these tables until migrations 66/71 are approved there; regenerate after the production cleanup",
    "src/lib/voiceJob.ts": "COMPATIBILITY: optional proof_id on a row type so recovery markers written by older recorder builds still match; never read from the server",
    "src/lib/voiceRound4.test.ts": "tests of that marker compatibility",
    "src/lib/voiceRound6.test.ts": "tests of that marker compatibility",
    "src/lib/voiceRound7.test.ts": "tests of that marker compatibility",
    "src/lib/voiceJob.test.ts": "tests of that marker compatibility",
    "scripts/dev-tools/staging_function_authz_check.py": "asserts the nine retired functions answer 404",
    "scripts/dev-tools/authz_matrix_check.py": "PRODUCTION check: production still has these objects until rollout; update at stage 7",
    "scripts/dev-tools/voice_modal_harness_browser.mjs": "recorder test harness: simulates rows and markers from older builds (same compatibility as voiceJob.ts)",
    "scripts/dev-tools/voice_modal_lifecycle_browser.mjs": "recorder test harness (same compatibility as voiceJob.ts)",
    "scripts/dev-tools/gen_guide_appendix.py": "generator of an old guide appendix (documentation tooling)",
}

SKIP = re.compile(r"\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|gz|zip|lock|lockb|svg)$|(^|/)package-lock\.json$")
pattern = re.compile(r"(?<![A-Za-z0-9_-])(" + "|".join(re.escape(t) for t in TERMS) + r")(?![A-Za-z0-9_-])")

files = [f for f in subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n") if f]
active, allowed, historical = {}, {}, {}
for f in files:
    if SKIP.search(f):
        continue
    try:
        text = open(f, encoding="utf-8").read()
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        continue
    for n, line in enumerate(text.split("\n"), 1):
        for m in pattern.finditer(line):
            bucket = historical if HISTORICAL.match(f) else allowed if f in ALLOW else active
            bucket.setdefault(m.group(1), []).append(f"{f}:{n}")

if "--report" in sys.argv:
    print(f"{'term':28s} {'active':>6} {'allowed':>8} {'historical':>10}")
    for t in TERMS:
        print(f"{t:28s} {len(active.get(t, [])):>6} {len(allowed.get(t, [])):>8} {len(historical.get(t, [])):>10}")
    print("\nallowed files:")
    for f, why in ALLOW.items():
        print(f"  {f}: {why}")

total = sum(len(v) for v in active.values())
for term, hits in sorted(active.items()):
    for h in hits[:20]:
        print(f"LEGACY: {term} in {h}")
print(f"legacy guard: {len(TERMS)} retired identifiers, {len(files)} tracked files, {total} active occurrences")
sys.exit(1 if total else 0)
