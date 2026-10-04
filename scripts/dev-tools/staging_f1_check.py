"""STAGING ONLY. Proves F1: the auth-bridge is the only signer.

  * a token signed with the old shared HS256 secret is refused by the API, functions,
    files, accounts and transcriber - for a user AND for service_role;
  * no staging service still has the shared secret in its configuration;
  * RS256 tokens work; forged ones (another key, 'none', HS256-with-public-key) do not;
  * /service-token refuses anything that is not a listed service's Google identity.

    python scripts/dev-tools/staging_f1_check.py
"""
import base64, hashlib, hmac, json, subprocess, sys, time, urllib.request, urllib.error
import os
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

P = "prooflab-508214"
S = "99999999-0001-0000-0000-000000000001"
BRIDGE = "https://prooflab-staging-auth-bridge-ysn2mpe6sa-el.a.run.app"
FILES = "https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app"
ACCOUNTS = "https://prooflab-staging-accounts-ysn2mpe6sa-el.a.run.app"
TRANSCRIBER = "https://prooflab-staging-transcriber-ysn2mpe6sa-el.a.run.app"
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:150], flush=True)


def req(url, token=None, method="GET", data=None):
    # A 503 "Rate exceeded" / quota answer comes from Google's front end when a scaled-to-zero
    # staging service cannot start (the 20-vCPU quota is shared with production and is full at
    # rest). It says nothing about the token, so wait and ask again; it is printed, not hidden.
    for attempt in range(4):
        r = urllib.request.Request(url, data=data, method=method,
                                   headers={**({"Authorization": f"Bearer {token}"} if token else {}), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=60) as x:
                return x.status, x.read().decode()[:200]
        except urllib.error.HTTPError as e:
            code, body = e.code, e.read().decode()[:200]
        if code == 503 and ("Rate exceeded" in body or "quota" in body) and attempt < 3:
            print(f"  (service could not start: {body[:60]!r}; retrying in 60 s)", flush=True)
            __import__("time").sleep(60)
            continue
        return code, body


b64 = st.b64
user_rs, svc_rs = st.token(f"user:{S}", alg="rs256"), st.token("svc", alg="rs256")
user_hs, svc_hs = st.token(f"user:{S}", alg="hs256"), st.token("svc", alg="hs256")

# Forgeries.
jwks = json.load(urllib.request.urlopen(f"{BRIDGE}/.well-known/jwks.json"))
kid = jwks["keys"][0]["kid"]
claims = b64(json.dumps({"role": "service_role", "exp": int(time.time()) + 600}).encode())
from cryptography.hazmat.primitives import hashes  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import padding, rsa  # noqa: E402
h = b64(json.dumps({"alg": "RS256", "typ": "JWT", "kid": kid}).encode())
other_key = h + "." + claims + "." + b64(rsa.generate_private_key(65537, 2048).sign(f"{h}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA256()))
hn = b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
alg_none = f"{hn}.{claims}."
hh = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": kid}).encode())
confusion = f"{hh}.{claims}." + b64(hmac.new(json.dumps(jwks).encode(), f"{hh}.{claims}".encode(), hashlib.sha256).digest())
forged = {"signed by another RSA key": other_key, "alg none": alg_none, "HS256 using the public key as secret": confusion,
          "legacy HS256 service_role": svc_hs}

check("bridge publishes exactly public RSA keys", all(k["kty"] == "RSA" and "d" not in k for k in jwks["keys"]) and len(jwks["keys"]) >= 1, [k["kid"] for k in jwks["keys"]])
c, _ = req(f"{BRIDGE}/ready")
check("bridge signs RS256", '"RS256"' in _, _)

# API (PostgREST)
api = st.API
c, b = req(f"{api}/student_profiles?select=full_name", user_rs)
check("API: RS256 user token works and sees only its own row", c == 200 and len(json.loads(b)) == 1, (c, b))
c, b = req(f"{api}/student_profiles?select=id&limit=2", svc_rs)
check("API: RS256 service token works", c == 200, c)
c, b = req(f"{api}/student_profiles?select=full_name", user_hs)
check("API: legacy HS256 user token refused", c == 401, (c, b))
for name, tok in forged.items():
    c, b = req(f"{api}/student_profiles?select=id&limit=1", tok)
    check(f"API refuses: {name}", c == 401, (c, b[:80]))

# Functions
fn = st.FUNCTIONS
body = json.dumps({"voice_id": "00000000-0000-0000-0000-000000000000"}).encode()
c, b = req(f"{fn}/voice-score", user_rs, "POST", body)
check("functions: RS256 user token is recognised (reaches the handler)", c in (403, 404), (c, b))
c, b = req(f"{fn}/voice-score", svc_rs, "POST", body)
check("functions: RS256 service token is recognised", c == 404, (c, b))
for name, tok in {**forged, "legacy HS256 user": user_hs}.items():
    c, b = req(f"{fn}/voice-score", tok, "POST", body)
    check(f"functions refuse: {name}", c == 401, (c, b[:80]))

# Files
c, b = req(f"{FILES}/file/voice-explanations/{S}/does-not-exist.wav", user_rs)
check("files: RS256 user token is recognised", c == 404 and "not found" in b, (c, b))
for name, tok in {"legacy HS256 user": user_hs, "signed by another RSA key": other_key, "alg none": alg_none}.items():
    c, b = req(f"{FILES}/file/voice-explanations/{S}/does-not-exist.wav", tok)
    check(f"files refuse: {name}", c == 401, (c, b[:80]))

# Transcriber and accounts: an unauthenticated-looking legacy token gets nothing.
c, b = req(f"{TRANSCRIBER}/transcribe", user_hs, "POST", b"x")
check("transcriber refuses legacy HS256", c == 401, (c, b[:80]))
c, b = req(f"{ACCOUNTS}/remove", user_hs, "POST", b"{}")
check("accounts refuses legacy HS256", c in (401, 403), (c, b[:80]))

# /service-token: only a listed service's Google identity.
for name, tok in {"no token": None, "a user's app token": user_rs, "a service app token": svc_rs, "garbage": "a.b.c"}.items():
    c, b = req(f"{BRIDGE}/service-token", tok, "POST", b"")
    check(f"bridge /service-token refuses: {name}", c == 401, (c, b[:60]))
me = subprocess.run("gcloud auth print-identity-token", shell=True, capture_output=True, text=True).stdout.strip()
if me:
    c, b = req(f"{BRIDGE}/service-token", me, "POST", b"")
    check("bridge /service-token refuses a real Google identity that is not a listed service (the operator)", c == 401, (c, b[:60]))

# No staging service still carries the shared secret.
for svc in ("functions", "files", "accounts", "transcription-worker", "transcriber", "auth-bridge"):
    out = subprocess.run(f'gcloud run services describe prooflab-staging-{svc} --region=asia-south1 --project={P} --format="value(spec.template.spec.containers[0].env)"',
                         shell=True, capture_output=True, text=True).stdout
    check(f"{svc}: no PGRST_JWT_SECRET, no legacy secret reference", "PGRST_JWT_SECRET" not in out and "prooflab-staging-jwt-secret" not in out)
out = subprocess.run(f'gcloud secrets get-iam-policy prooflab-staging-app-signing-key --project={P} --format="value(bindings.members)"',
                     shell=True, capture_output=True, text=True).stdout
check("signing key readable by the bridge robot only", f"serviceAccount:prooflab-staging-auth-bridge@{P}.iam.gserviceaccount.com" in out and out.count("serviceAccount:") == 1
      and "user:" not in out and "group:" not in out and "allUsers" not in out, out.strip())

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
