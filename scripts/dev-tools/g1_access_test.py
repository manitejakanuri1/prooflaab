"""Step 6 G1: live STAGING access-control test for voice-score.

Never prints secrets or tokens. Tokens are minted in memory by st.py exactly like the
staging auth-bridge's (RS256 since F1, key read from Secret Manager at run time): a
3-minute service_role token playing transcription-worker, and t07's student ticket.
Run:
  python scripts/dev-tools/g1_access_test.py
Creates 5 labelled test rows on STAGING (idempotency key g1s-test-*). Makes 2 real DeepSeek calls.
"""
import json, os, sys, time, urllib.error, urllib.request

# Keep the current st.py staging-token architecture.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import st  # noqa: E402  staging token helper (same folder)

# Reuse the configured public browser API key instead of duplicating it here.
sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    ),
)
from google_api_key import google_api_key  # noqa: E402

API_KEY = google_api_key(".env.staging")
BRIDGE = "https://prooflab-staging-auth-bridge-ysn2mpe6sa-el.a.run.app"
API = "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app"
FN = "https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app"
T07 = "7d71bff4-1ec2-4778-b26d-9567a416bfac"
T16 = "67c7f711-6ca8-4b4d-a586-278857dcb0ab"
AUDIO = f"{T07}/1790365705557-explain.webm"
WORDS = ("I built a queue for transcription using cloud tasks and Postgres, first I tried polling "
         "but it was slow so I changed it")


def call(url, body=None, token=None, method="POST", headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    if token:
        h["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:200].decode(errors="replace")


def service_token():
    return st.token("svc", ttl=180)


def student_token():
    """The t07 password in Secret Manager does not sign in (INVALID_LOGIN_CREDENTIALS,
    tried once). So this mints the ticket the staging auth-bridge issues after a login
    (role authenticated, sub = the account's database uuid) with st.py. Equivalent for
    voice-score's checks; it does not exercise Identity Platform."""
    s, body = call(f"{API}/student_profiles?id=eq.{T07}&select=user_id", None, SVC, method="GET")
    assert s == 200 and body, f"t07 lookup failed: {s}"
    return st.token("user:" + body[0]["user_id"], ttl=180)


SVC = service_token()
STU = student_token()
stamp = int(time.time())


def insert(label, **cols):
    row = {"storage_path": AUDIO, "duration_seconds": 20,
           "transcription_idempotency_key": f"g1s-test-{label}-{stamp}", **cols}
    s, body = call(f"{API}/voice_explanations", row, SVC, headers={"Prefer": "return=representation"})
    assert s in (200, 201), f"insert {label}: {s} {body}"
    return body[0]["id"]


def row(vid):
    s, body = call(f"{API}/voice_explanations?id=eq.{vid}&select=status,transcript,word_count,communication_score,"
                   f"communication_notes,scoring_claimed_at,scoring_lease_token,transcription_status,transcript_source",
                   None, SVC, method="GET")
    return body[0]


ids = {
    "unfinished_server": insert("unfinished-server", student_id=T07, transcript_source="server",
                                transcription_status="pending", transcript=None),
    "completed_server": insert("completed-server", student_id=T07, transcript_source="server",
                               transcription_status="completed", transcript=WORDS, word_count=len(WORDS.split())),
    "own_browser": insert("own-browser", student_id=T07, transcript_source="browser",
                          transcript=WORDS, word_count=len(WORDS.split())),
    "other_browser": insert("other-browser", student_id=T16, transcript_source="browser",
                            transcript=WORDS, word_count=len(WORDS.split())),
    "completed_server_2": insert("completed-server-2", student_id=T07, transcript_source="server",
                                 transcription_status="completed", transcript=WORDS, word_count=len(WORDS.split())),
}
print("rows:", json.dumps(ids, indent=1))

results = []


def check(name, token, vid, want_status, must_be_unchanged):
    before = row(vid) if vid else None
    s, body = call(f"{FN}/voice-score", {"voice_id": vid if vid else "not-a-uuid"}, token)
    after = row(vid) if vid else None
    unchanged = before == after
    ok = s == want_status and (unchanged if must_be_unchanged else True)
    results.append(ok)
    brief = body if not isinstance(body, dict) else {k: body[k] for k in body if k in ("error", "reason", "success", "communication_score", "pending")}
    print(f"{'PASS' if ok else 'FAIL'}  {name}: HTTP {s} (want {want_status}) {brief}"
          + (f"  row unchanged={unchanged}" if vid else "")
          + (f"  -> status={after['status']} score={after['communication_score']}" if vid else ""))


check("S1 student scores own UNFINISHED server recording", STU, ids["unfinished_server"], 403, True)
check("S2 student scores own COMPLETED server recording (server-only)", STU, ids["completed_server"], 403, True)
check("S3 student scores own BROWSER recording (sync path)", STU, ids["own_browser"], 200, False)
check("S4 student scores ANOTHER student's browser recording", STU, ids["other_browser"], 403, True)
check("S5 server scores COMPLETED server recording", SVC, ids["completed_server_2"], 200, False)
check("S6 server scores UNFINISHED server recording", SVC, ids["unfinished_server"], 409, True)
check("S7 server scores a BROWSER recording", SVC, ids["other_browser"], 409, True)
check("S8 malformed voice_id", STU, None, 400, False)
print(f"\n{sum(results)}/{len(results)} passed")
