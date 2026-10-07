"""Probe ProofLab like the browser does. usage:
  python pl.py svc GET  "student_profiles?select=id&limit=1"
  python pl.py recruiter RPC recruiter_talent '{}'
"""
import base64, hashlib, hmac, json, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from google_api_key import google_api_key

KEY = google_api_key()
BRIDGE = "https://prooflab-auth-bridge-ysn2mpe6sa-el.a.run.app"
API = "https://prooflab-api-ysn2mpe6sa-el.a.run.app"
EMAIL = {"admin": "vidyuthsetu@gmail.com", "college": "vidyuthsetu+college@gmail.com",
         "recruiter": "vidyuthsetu+recruiter@gmail.com", "startup": "vidyuthsetu+startup@gmail.com",
         "student": "vidyuthsetu+smoke01@gmail.com"}  # dedicated test student (older test logins removed 30 Sep 2026)
SECRET = {"student": "prooflab-smoke-student-password"}

def secret(name):
    return subprocess.run(f"gcloud secrets versions access latest --secret={name}", shell=True,
                          capture_output=True, text=True, check=True).stdout.strip()

def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})}, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def b64(x):
    return base64.urlsafe_b64encode(x).rstrip(b"=").decode()

def token(who):
    if who == "svc":
        k = secret("prooflab-jwt-secret").encode()
        h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        p = b64(json.dumps({"role": "service_role", "exp": int(time.time()) + 600}).encode())
        return f"{h}.{p}." + b64(hmac.new(k, f"{h}.{p}".encode(), hashlib.sha256).digest())
    pw = secret(SECRET.get(who, f"prooflab-{who}-password"))
    st, j = http(f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={KEY}",
                 {"email": EMAIL[who], "password": pw, "returnSecureToken": True})
    assert st == 200, j
    st, t = http(f"{BRIDGE}/token", {}, {"Authorization": f"Bearer {j['idToken']}"}, "POST")
    assert st == 200, t
    return t["access_token"]

if __name__ == "__main__":
    who, verb, path = sys.argv[1:4]
    body = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
    h = {"Authorization": f"Bearer {token(who)}", "Prefer": "return=representation"}
    if verb == "RPC":
        st, out = http(f"{API}/rpc/{path}", body or {}, h, "POST")
    else:
        st, out = http(f"{API}/{path}", body, h, verb)
    print(st, json.dumps(out, indent=1, default=str)[:6000])
