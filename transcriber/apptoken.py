"""Application tokens for the Python services (F1). Standard library only.

The auth-bridge is the only signer. A service here:
  * VERIFIES a token: RS256 against the bridge's public keys (APP_JWT_PUBLIC_JWKS, public
    JSON), or legacy HS256 only while PGRST_JWT_SECRET is still configured on it;
  * OBTAINS a service token from the bridge (SIGNER_URL) by presenting its own Google
    identity token - no shared secret. Without SIGNER_URL it falls back to the legacy
    self-signed HS256 token.

accounts/, transcription-worker/ and transcriber/ each carry a byte-for-byte copy of this
file (each image is built from its own folder); CI fails if the copies differ.
"""
import base64, hashlib, hmac, json, os, threading, time, urllib.parse, urllib.request

# DER prefix of DigestInfo for SHA-256 (PKCS #1 v1.5, RFC 8017 section 9.2).
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")
_lock = threading.Lock()
_cached = {"token": "", "expires": 0.0}


def _unb64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _rsa_ok(n: int, e: int, signed: bytes, sig: bytes) -> bool:
    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        return False
    em = pow(int.from_bytes(sig, "big"), e, n).to_bytes(k, "big")
    t = _SHA256_PREFIX + hashlib.sha256(signed).digest()
    return hmac.compare_digest(em, b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t)


def verify(token: str, env=os.environ):
    """The verified claims (dict), or None. None always means "refuse"."""
    try:
        head, body, sig = token.split(".")
        header = json.loads(_unb64(head))
        signed = f"{head}.{body}".encode()
        alg = header.get("alg")
        if alg == "RS256":
            keys = json.loads(env.get("APP_JWT_PUBLIC_JWKS") or "{}").get("keys", [])
            key = next((k for k in keys if k.get("kty") == "RSA" and k.get("kid") and k.get("kid") == header.get("kid")), None)
            if not key:
                return None
            n = int.from_bytes(_unb64(key["n"]), "big")
            e = int.from_bytes(_unb64(key["e"]), "big")
            if n.bit_length() < 2048 or not _rsa_ok(n, e, signed, _unb64(sig)):
                return None
        elif alg == "HS256":
            secret = (env.get("PGRST_JWT_SECRET") or "").encode()
            if not secret or not hmac.compare_digest(hmac.new(secret, signed, hashlib.sha256).digest(), _unb64(sig)):
                return None
        else:
            return None
        claims = json.loads(_unb64(body))
        if float(claims.get("exp", 0)) <= time.time():
            return None
        return claims
    except Exception:
        return None


def user_id(auth_header, env=os.environ):
    """The signed-in person's id from an Authorization header, or None."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    claims = verify(auth_header[7:], env)
    if not claims or claims.get("role") != "authenticated":
        return None
    return str(claims.get("sub") or "") or None


def is_service(auth_header, env=os.environ) -> bool:
    """True for a verified service_role token (another backend service)."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
    claims = verify(auth_header[7:], env)
    return bool(claims) and claims.get("role") == "service_role"


def _get(url, headers, data=None):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read().decode()


def service_token(env=os.environ, fetch=_get) -> str:
    """A short-lived service_role token: from the bridge when SIGNER_URL is set, else legacy HS256."""
    signer = (env.get("SIGNER_URL") or "").rstrip("/")
    if not signer:
        secret = (env.get("PGRST_JWT_SECRET") or "").encode()
        if not secret:
            raise RuntimeError("neither SIGNER_URL nor PGRST_JWT_SECRET is set; cannot reach the database")
        head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        body = _b64(json.dumps({"role": "service_role", "exp": int(time.time()) + 300}).encode())
        return f"{head}.{body}." + _b64(hmac.new(secret, f"{head}.{body}".encode(), hashlib.sha256).digest())
    with _lock:
        if _cached["token"] and _cached["expires"] > time.time() + 30:
            return _cached["token"]
        identity = fetch(
            "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience="
            + urllib.parse.quote(signer, safe=""), {"Metadata-Flavor": "Google"}).strip()
        reply = json.loads(fetch(f"{signer}/service-token", {"Authorization": f"Bearer {identity}"}, b""))
        _cached.update(token=reply["access_token"], expires=time.time() + float(reply["expires_in"]))
        return _cached["token"]


def reset_cache():
    _cached.update(token="", expires=0.0)
