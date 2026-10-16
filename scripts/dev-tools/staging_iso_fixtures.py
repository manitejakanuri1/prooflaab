"""STAGING ONLY. Disposable logins in the ISOLATED staging Identity project for staging test fixtures.

    python scripts/dev-tools/staging_iso_fixtures.py --plan            # what it would create (counts, no addresses)
    python scripts/dev-tools/staging_iso_fixtures.py --create          # create them; passwords -> Secret Manager

Which accounts (read from the staging database, never production):
  * every staging account with a login link whose address is on a TEST domain (.invalid, @staging.local);
  * every protected test account (protected_test_accounts) on a test domain, linked or not (uuid-named E2E logins).
Never: any other address (e.g. @gmail.com - owner hold, 13 Oct 2026), any production login, any real person.

Each login is created with the SAME login id it has today, so every account_identities mapping (and every uuid-named
account) keeps resolving to the same app account. Passwords are NEW and random (nothing is copied from anywhere),
written only to Secret Manager secret SECRET as one JSON object {email: password}; nothing is printed. Re-running
skips logins that already exist (DUPLICATE_LOCAL_ID / EMAIL_EXISTS) and keeps their passwords.
"""
import json, os, secrets, shutil, subprocess, sys, urllib.error, urllib.request

IDENTITY_PROJECT = "prooflab-stg-identity-508214"          # the isolated staging pool - refuses anything else
INFRA = "prooflab-508214"
SECRET = "prooflab-staging-iso-fixture-logins"
TEST_DOMAINS = (".invalid", "@staging.local")      # reserved, non-routable test domains only
HERE = os.path.dirname(os.path.abspath(__file__))
GCLOUD = shutil.which("gcloud") or "gcloud"          # gcloud.cmd on Windows

SQL = r"""\pset format unaligned
\pset tuples_only on
\pset pager off
select 'FIX|' || x.user_id || '|' || x.provider_uid || '|' || x.email || '|' || coalesce(r.role::text, '-') || '|' || x.protected
  from (
    select ai.user_id, ai.provider_uid, lower(coalesce(ai.email, u.email)) email,
           exists (select 1 from public.protected_test_accounts t where t.user_id = ai.user_id) protected
      from public.account_identities ai left join auth.users u on u.id = ai.user_id
    union
    select t.user_id, t.user_id::text, lower(u.email), true
      from public.protected_test_accounts t join auth.users u on u.id = t.user_id
     where not exists (select 1 from public.account_identities ai where ai.user_id = t.user_id)
  ) x left join public.user_roles r on r.user_id = x.user_id
 where x.email is not null;
"""


def run(cmd, data=None):
    return subprocess.run(cmd, input=data, capture_output=True, text=True, check=True).stdout


def fixtures():
    path = os.path.join(os.environ.get("TEMP", "/tmp"), "iso_fixtures.sql")
    open(path, "w", encoding="utf-8").write(SQL)
    out = subprocess.run(["bash", os.path.join(HERE, "staging_sql.sh"), path], capture_output=True, text=True)
    if "staging_sql exit=0" not in out.stdout:
        sys.exit("staging query failed")
    ex = out.stdout.strip().split("(")[-1].rstrip(")")
    logs = run([GCLOUD, "logging", "read",
                f'resource.type=cloud_run_job AND labels."run.googleapis.com/execution_name"={ex}',
                f"--project={INFRA}", "--freshness=30m", "--format=value(textPayload)"])
    rows = {}
    for line in logs.splitlines():
        if line.startswith("FIX|"):
            _, uid, puid, email, role, prot = line.split("|")
            rows[uid] = {"user_id": uid, "provider_uid": puid, "email": email, "role": role, "protected": prot in ("t", "true")}
    return list(rows.values())


def plan(rows):
    take = [r for r in rows if r["email"].endswith(TEST_DOMAINS) and r["role"] != "-"]
    skip = [r for r in rows if r not in take]
    return take, skip


def identity(path, body, token):
    req = urllib.request.Request(f"https://identitytoolkit.googleapis.com/v1/projects/{IDENTITY_PROJECT}/{path}",
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "x-goog-user-project": IDENTITY_PROJECT,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def existing_secret():
    try:
        return json.loads(run([GCLOUD, "secrets", "versions", "access", "latest", f"--secret={SECRET}", f"--project={INFRA}"]))
    except Exception:
        return {}


def main():
    take, skip = plan(fixtures())
    # --only=<prefix>: limit to addresses starting with it (e.g. --only=sim12.), so one fixture set
    # can get its logins without touching any other staging account.
    only = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--only=")), None)
    if only:
        take = [r for r in take if r["email"].startswith(only)]
    by_role = {}
    for r in take:
        by_role[r["role"]] = by_role.get(r["role"], 0) + 1
    print(f"fixtures to have in {IDENTITY_PROJECT}: {len(take)} {by_role}; protected among them: "
          f"{sum(r['protected'] for r in take)}; NOT touched (non-test address or no role): {len(skip)}")
    if "--create" not in sys.argv:
        return
    token = run([GCLOUD, "auth", "print-access-token"]).strip()
    passwords, created, kept, failed = existing_secret(), 0, 0, 0
    for r in take:
        pw = passwords.get(r["email"]) or secrets.token_urlsafe(18)
        st, out = identity("accounts", {"localId": r["provider_uid"], "email": r["email"], "password": pw,
                                        "emailVerified": True, "disabled": False}, token)
        if st == 200:
            passwords[r["email"]] = pw; created += 1
        elif "DUPLICATE_LOCAL_ID" in json.dumps(out) or "EMAIL_EXISTS" in json.dumps(out):
            kept += 1
        else:
            failed += 1
            print(f"create failed for one {r['role']} fixture: HTTP {st} {str(out.get('error', {}).get('message'))[:80]}")
    if created:
        payload = json.dumps(passwords)
        try:
            run([GCLOUD, "secrets", "describe", SECRET, f"--project={INFRA}"])
        except subprocess.CalledProcessError:
            run([GCLOUD, "secrets", "create", SECRET, f"--project={INFRA}", "--replication-policy=automatic"])
        run([GCLOUD, "secrets", "versions", "add", SECRET, f"--project={INFRA}", "--data-file=-"], data=payload)
    print(f"created {created}, already present {kept}, failed {failed}; passwords in secret {SECRET} (not printed)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
