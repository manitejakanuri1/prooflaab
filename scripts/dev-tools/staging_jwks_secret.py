"""STAGING ONLY. Writes the key set staging PostgREST verifies tokens with (F1).

    python scripts/dev-tools/staging_jwks_secret.py transition   # bridge public key + legacy HS256 key
    python scripts/dev-tools/staging_jwks_secret.py final        # bridge public key only (HS256 refused)

Nothing secret is printed or written to disk: the legacy secret is read from Secret
Manager and piped straight into the new secret version. Prints only key ids and types.
"""
import base64, json, subprocess, sys, urllib.request

P = "prooflab-508214"
BRIDGE = "https://prooflab-staging-auth-bridge-ysn2mpe6sa-el.a.run.app"
SECRET = "prooflab-staging-jwt-jwks"
mode = sys.argv[1]
assert mode in ("transition", "final")

gcloud = lambda *a, **k: subprocess.run("gcloud " + " ".join(a), shell=True, capture_output=True, text=True, **k)
keys = json.load(urllib.request.urlopen(f"{BRIDGE}/.well-known/jwks.json"))["keys"]
assert keys and all(k["kty"] == "RSA" and "d" not in k for k in keys), "bridge published no usable public key"
if mode == "transition":
    legacy = gcloud("secrets versions access latest --secret=prooflab-staging-jwt-secret", f"--project={P}").stdout.strip()
    assert legacy
    keys = keys + [{"kty": "oct", "alg": "HS256", "kid": "legacy-hs256",
                    "k": base64.urlsafe_b64encode(legacy.encode()).rstrip(b"=").decode()}]
payload = json.dumps({"keys": keys})

if gcloud(f"secrets describe {SECRET}", f"--project={P}").returncode != 0:
    r = gcloud(f"secrets create {SECRET} --replication-policy=automatic", f"--project={P}")
    assert r.returncode == 0, r.stderr
    gcloud(f"secrets add-iam-policy-binding {SECRET} --role=roles/secretmanager.secretAccessor",
           f"--member=serviceAccount:prooflab-staging-api@{P}.iam.gserviceaccount.com", f"--project={P}")
r = gcloud(f"secrets versions add {SECRET} --data-file=-", f"--project={P}", input=payload)
assert r.returncode == 0, r.stderr
print(mode, "key set written:", [(k["kid"], k["kty"]) for k in keys])
print("public JWKS for verifiers:", json.dumps({"keys": [k for k in keys if k["kty"] == "RSA"]}))
