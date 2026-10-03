"""Staging-only probe helper. Never points at production.

  python st.py svc GET "student_profiles?select=id&limit=1"
  python st.py user:<uuid> PATCH "resume_assessments?id=eq.<id>" '{"status":"x"}'

`user:<uuid>` mints a staging ticket shaped exactly like the staging auth-bridge's
(role=authenticated, sub=<uuid>), so a probe sees what that student's browser sees.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.request, urllib.error

API = "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app"
FUNCTIONS = "https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app"
_secret = None


def secret() -> bytes:
    global _secret
    if _secret is None:
        _secret = subprocess.run("gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret",
                                 shell=True, capture_output=True, text=True, check=True).stdout.strip().encode()
    return _secret


def b64(x: bytes) -> str:
    return base64.urlsafe_b64encode(x).rstrip(b"=").decode()


_rsa = None


def rsa_key():
    """Staging signing key (F1), read from Secret Manager at run time. Returns (key, kid)."""
    global _rsa
    if _rsa is None:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        raw = subprocess.run("gcloud secrets versions access latest --secret=prooflab-staging-app-signing-key",
                             shell=True, capture_output=True, text=True, check=True).stdout
        # Re-wrap the body: line endings picked up on the way must not matter, and a
        # parse failure must never echo key text into a terminal or a log.
        body = "".join(l.strip() for l in raw.splitlines() if l.strip() and "-----" not in l)
        nl = chr(10)
        pem = ("-----BEGIN PRIVATE KEY-----" + nl
               + nl.join(body[i:i + 64] for i in range(0, len(body), 64)) + nl
               + "-----END PRIVATE KEY-----" + nl)
        try:
            key = load_pem_private_key(pem.encode(), None)
        except Exception:
            raise SystemExit("could not load the staging signing key (details withheld)") from None
        n = key.public_key().public_numbers().n
        kid = hashlib.sha256(b64(n.to_bytes((n.bit_length() + 7) // 8, "big")).encode()).hexdigest()[:16]
        _rsa = (key, kid)
    return _rsa


def token(who: str, ttl: int = 600, alg: str | None = None) -> str:
    """A staging ticket shaped like the staging auth-bridge's. RS256 by default (the
    bridge's algorithm since F1); ST_ALG=hs256 mints the legacy kind, to prove it is refused."""
    alg = (alg or os.environ.get("ST_ALG", "rs256")).lower()
    claims = {"role": "service_role", "svc": "staging-test-tooling"} if who == "svc" else {
        "role": "authenticated", "sub": who.split(":", 1)[1], "email_confirmed": True}
    claims["exp"] = int(time.time()) + ttl
    if alg == "hs256":
        h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        p = b64(json.dumps(claims).encode())
        return f"{h}.{p}." + b64(hmac.new(secret(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    key, kid = rsa_key()
    h = b64(json.dumps({"alg": "RS256", "typ": "JWT", "kid": kid}).encode())
    p = b64(json.dumps(claims).encode())
    return f"{h}.{p}." + b64(key.sign(f"{h}.{p}".encode(), padding.PKCS1v15(), hashes.SHA256()))


def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except ValueError:
            return e.code, body


def call(who, verb, path, body=None):
    h = {"Authorization": f"Bearer {token(who)}", "Prefer": "return=representation"}
    if verb == "RPC":
        return http(f"{API}/rpc/{path}", body or {}, h, "POST")
    if verb == "FN":
        return http(f"{FUNCTIONS}/{path}", body or {}, h, "POST")
    return http(f"{API}/{path}", body, h, verb)


if __name__ == "__main__":
    who, verb, path = sys.argv[1:4]
    body = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
    st, out = call(who, verb, path, body)
    print(st, json.dumps(out, indent=1, default=str)[:4000])
