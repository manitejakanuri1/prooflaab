"""Tests for apptoken.py (F1). Run: python accounts/test_apptoken.py
Uses the 'cryptography' package only to MAKE test keys and signatures; apptoken itself is stdlib-only."""
import base64, hashlib, hmac, json, time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

import apptoken

b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
soon = lambda: int(time.time()) + 600


def keypair(kid, bits=2048):
    key = rsa.generate_private_key(public_exponent=65537, key_size=bits)
    n = key.public_key().public_numbers().n
    jwk = {"kty": "RSA", "kid": kid, "alg": "RS256", "e": "AQAB", "n": b64(n.to_bytes((n.bit_length() + 7) // 8, "big"))}

    def sign(claims, header=None):
        h = b64(json.dumps(header or {"alg": "RS256", "kid": kid}).encode())
        p = b64(json.dumps(claims).encode())
        return f"{h}.{p}." + b64(key.sign(f"{h}.{p}".encode(), padding.PKCS1v15(), hashes.SHA256()))
    return sign, jwk


def hs(secret, claims):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64(json.dumps(claims).encode())
    return f"{h}.{p}." + b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())


sign_a, jwk_a = keypair("a")
sign_b, _ = keypair("a")           # same kid, different key
env = {"APP_JWT_PUBLIC_JWKS": json.dumps({"keys": [jwk_a]})}
good = {"sub": "u1", "role": "authenticated", "exp": soon()}

# accepted
assert apptoken.verify(sign_a(good), env)["sub"] == "u1"
assert apptoken.user_id("Bearer " + sign_a(good), env) == "u1"
assert apptoken.is_service("Bearer " + sign_a({"role": "service_role", "exp": soon()}), env)
legacy = {"PGRST_JWT_SECRET": "legacy-secret-legacy-secret-legacy!"}
assert apptoken.verify(hs(legacy["PGRST_JWT_SECRET"], good), legacy)["sub"] == "u1"

# refused
assert apptoken.verify(sign_b(good), env) is None, "another key with the same kid"
assert apptoken.verify(sign_a(good, {"alg": "RS256", "kid": "zzz"}), env) is None, "unknown kid"
assert apptoken.verify(sign_a({**good, "exp": 1}), env) is None, "expired"
assert apptoken.verify(hs(legacy["PGRST_JWT_SECRET"], good), env) is None, "HS256 when no legacy secret is configured"
assert apptoken.verify(hs(env["APP_JWT_PUBLIC_JWKS"], good), env) is None, "HS256 signed with the public key text"
assert apptoken.verify(b64(b'{"alg":"none"}') + "." + b64(json.dumps(good).encode()) + ".", env) is None, "alg none"
assert apptoken.verify("garbage", env) is None
token = sign_a(good)
tampered = token.split(".")
tampered[1] = b64(json.dumps({**good, "sub": "someone-else"}).encode())
assert apptoken.verify(".".join(tampered), env) is None, "payload changed after signing"
assert apptoken.user_id("Bearer " + sign_a({"role": "service_role", "exp": soon()}), env) is None, "a service is not a person"
assert not apptoken.is_service("Bearer " + sign_a(good), env), "a person is not a service"
sign_small, jwk_small = keypair("s", 1024)
assert apptoken.verify(sign_small(good), {"APP_JWT_PUBLIC_JWKS": json.dumps({"keys": [jwk_small]})}) is None, "weak key"
oct_env = {"APP_JWT_PUBLIC_JWKS": json.dumps({"keys": [{"kty": "oct", "kid": "a", "k": b64(b"s3cret")}]})}
assert apptoken.verify(sign_a(good), oct_env) is None, "a symmetric key in the public list"

# service token: from the signer with this service's identity, cached; legacy without a signer
calls = []


def fetch(url, headers, data=None):
    calls.append(url)
    if url.startswith("http://metadata.google.internal"):
        assert "audience=https%3A%2F%2Fbridge.example" in url and headers == {"Metadata-Flavor": "Google"}
        return "ID.TOKEN\n"
    assert url == "https://bridge.example/service-token" and headers == {"Authorization": "Bearer ID.TOKEN"} and data == b""
    return json.dumps({"access_token": "svc.token", "expires_in": 600})


apptoken.reset_cache()
signer_env = {"SIGNER_URL": "https://bridge.example/"}
assert apptoken.service_token(signer_env, fetch) == "svc.token"
assert apptoken.service_token(signer_env, fetch) == "svc.token" and len(calls) == 2, "second call must come from the cache"
apptoken.reset_cache()
assert apptoken.verify(apptoken.service_token(legacy), legacy)["role"] == "service_role"
try:
    apptoken.service_token({})
    raise AssertionError("no signer and no secret must fail loudly")
except RuntimeError:
    pass
print("apptoken: all checks passed")
