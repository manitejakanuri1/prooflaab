"""Step 6DD: build the staging rehearsal for migration 45 (no database access).

Writes migration/step6dd-migration-45-staging-rehearsal-proxy.sql and
prints the bash payload for the existing prooflab-staging-inspect4 job.

The proxy file is the production script with every schema-qualified name
moved from `public` to a throwaway schema `s6dd_rehearsal`, wrapped in
one transaction that always ends in ROLLBACK. Staging's real public
functions (already at migration 45) are never read-for-write, dropped
or replaced.
"""
import base64, gzip, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROD = (ROOT / "migration/step6dd-migration-45-production-execution.sql").read_text(encoding="utf-8")
VERIFY = (ROOT / "migration/step6dd-migration-45-production-verify-readonly.sql").read_text(encoding="utf-8")
S = "s6dd_rehearsal"

SETUP = f"""begin;

-- throwaway copy of the objects migration 45 touches, in the
-- "migration 44 applied" state. Everything below is rolled back.
create schema {S};
create table {S}.voice_explanations (
  id uuid primary key,
  status text not null default 'recorded'
    check (status in ('recorded', 'scored', 'failed')),
  transcript text,
  communication_score integer,
  communication_notes text,
  scoring_claimed_at timestamptz
);
alter table {S}.voice_explanations enable row level security;
-- same column protection trigger production has (stage6)
create trigger protect_voice_explanations before update on {S}.voice_explanations
  for each row execute function public.protect_columns(
    'communication_score', 'communication_notes', 'status', 'transcript');
grant select, insert, update, delete on {S}.voice_explanations to service_role;
create function {S}.guard_voice_explanations_insert() returns trigger
  language plpgsql as $f$ begin return new; end $f$;

-- migration 44's function, exactly as 44 creates it (schema moved)
create or replace function {S}.claim_voice_scoring(_id uuid, _claim_ttl_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path to '{S}', 'pg_temp'
as $function$
declare n integer;
begin
  update {S}.voice_explanations
     set scoring_claimed_at = now()
   where id = _id
     and status <> 'scored'
     and (scoring_claimed_at is null
          or scoring_claimed_at < now() - make_interval(secs => _claim_ttl_seconds));
  get diagnostics n = row_count;
  return n > 0;
end $function$;
revoke all on function {S}.claim_voice_scoring(uuid, integer) from public, anon, authenticated;
grant execute on function {S}.claim_voice_scoring(uuid, integer) to service_role;
"""

FUNCTIONAL = f"""
-- behaviour checks on the rehearsal copy (still inside the transaction)
do $$
declare
  r1 uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  r3 uuid := gen_random_uuid();
  c record; t1 uuid; t2 uuid; ok boolean; v record;
  r4 uuid := gen_random_uuid();
  r5 uuid := gen_random_uuid();
  r6 uuid := gen_random_uuid();
  raised boolean;
begin
  -- run as PostgREST would for voice-score: service_role JWT claims
  perform set_config('request.jwt.claims', '{{"role":"service_role"}}', true);
  insert into {S}.voice_explanations (id) values (r1), (r2), (r3), (r4), (r5), (r6);

  select * into c from {S}.claim_voice_scoring(r1);
  if not c.claimed or c.lease_token is null then raise exception 'F1 first claim failed'; end if;
  t1 := c.lease_token;

  select * into c from {S}.claim_voice_scoring(r1);
  if c.claimed or c.lease_token is not null then raise exception 'F2 second claim on a fresh lease was allowed'; end if;

  if {S}.complete_voice_scoring(r1, gen_random_uuid(), 50, 'forged') then
    raise exception 'F3 complete with a wrong token was accepted'; end if;

  update {S}.voice_explanations set scoring_claimed_at = now() - interval '200 seconds' where id = r1;
  select * into c from {S}.claim_voice_scoring(r1);
  if not c.claimed or c.lease_token = t1 then raise exception 'F4 stale lease was not taken over with a new token'; end if;
  t2 := c.lease_token;

  if {S}.complete_voice_scoring(r1, t1, 10, 'late write from the expired claim') then
    raise exception 'F5 late complete from the expired lease was accepted'; end if;
  if {S}.fail_voice_scoring(r1, t1, 'late fail') then
    raise exception 'F6 late fail from the expired lease released the new claim'; end if;
  select * into v from {S}.voice_explanations where id = r1;
  if v.communication_score is not null or v.status <> 'recorded' then
    raise exception 'F7 row changed by a rejected write'; end if;

  if not {S}.complete_voice_scoring(r1, t2, 80, 'ok') then raise exception 'F8 valid complete rejected'; end if;
  select * into v from {S}.voice_explanations where id = r1;
  if v.status <> 'scored' or v.communication_score <> 80 then raise exception 'F9 score not saved'; end if;

  select * into c from {S}.claim_voice_scoring(r1);
  if c.claimed then raise exception 'F10 claim allowed on an already scored row'; end if;

  select * into c from {S}.claim_voice_scoring(r2);
  if not {S}.fail_voice_scoring(r2, c.lease_token, 'boom') then raise exception 'F11 valid fail rejected'; end if;
  select * into v from {S}.voice_explanations where id = r2;
  if v.status <> 'failed' or v.scoring_claimed_at is not null or v.scoring_lease_token is not null then
    raise exception 'F12 fail did not release the claim'; end if;

  -- F13/F14: the Step 6DD race. A late or repeated fail carrying the
  -- SAME token that just saved a score must not undo the score.
  select * into c from {S}.claim_voice_scoring(r3);
  if not {S}.complete_voice_scoring(r3, c.lease_token, 70, 'good') then raise exception 'F13a complete rejected'; end if;
  if {S}.fail_voice_scoring(r3, c.lease_token, 'late fail after success') then
    raise exception 'F13 late fail with the same token was accepted on a scored row'; end if;
  select * into v from {S}.voice_explanations where id = r3;
  if v.status <> 'scored' or v.communication_score <> 70 or v.communication_notes <> 'good' then
    raise exception 'F14 scored row was changed by a late fail (status %, score %)', v.status, v.communication_score; end if;

  -- F15/F16: a repeated complete with the SAME token must not overwrite
  -- the saved score.
  if {S}.complete_voice_scoring(r3, c.lease_token, 5, 'overwrite attempt') then
    raise exception 'F15 repeated complete with the same token was accepted on a scored row'; end if;
  select * into v from {S}.voice_explanations where id = r3;
  if v.status <> 'scored' or v.communication_score <> 70 or v.communication_notes <> 'good' then
    raise exception 'F16 saved score was overwritten (score %, notes %)', v.communication_score, v.communication_notes; end if;

  -- F17-F19: invalid TTL must raise, never take over a live claim
  select * into c from {S}.claim_voice_scoring(r4);   -- live claim on r4
  t1 := c.lease_token;
  raised := false; begin perform {S}.claim_voice_scoring(r4, 0); exception when others then raised := true; end;
  if not raised then raise exception 'F17 TTL 0 accepted'; end if;
  raised := false; begin perform {S}.claim_voice_scoring(r4, null); exception when others then raised := true; end;
  if not raised then raise exception 'F18 TTL null accepted'; end if;
  raised := false; begin perform {S}.claim_voice_scoring(r4, -5); exception when others then raised := true; end;
  if not raised then raise exception 'F19 negative TTL accepted'; end if;
  if (select scoring_lease_token from {S}.voice_explanations where id = r4) <> t1 then
    raise exception 'F19b live lease changed by an invalid-TTL call'; end if;

  -- F20-F22: score outside 0-100 or null must raise and change nothing
  raised := false; begin perform {S}.complete_voice_scoring(r4, t1, 101, 'x'); exception when others then raised := true; end;
  if not raised then raise exception 'F20 score 101 accepted'; end if;
  raised := false; begin perform {S}.complete_voice_scoring(r4, t1, -1, 'x'); exception when others then raised := true; end;
  if not raised then raise exception 'F21 score -1 accepted'; end if;
  raised := false; begin perform {S}.complete_voice_scoring(r4, t1, null, 'x'); exception when others then raised := true; end;
  if not raised then raise exception 'F22 null score accepted'; end if;
  if (select status from {S}.voice_explanations where id = r4) <> 'recorded' then
    raise exception 'F22b row changed by a rejected score'; end if;

  -- F23/F24: boundaries 0 and 100 are valid
  if not {S}.complete_voice_scoring(r4, t1, 0, 'zero') then raise exception 'F23 score 0 rejected'; end if;
  select * into c from {S}.claim_voice_scoring(r5);
  if not {S}.complete_voice_scoring(r5, c.lease_token, 100, 'hundred') then raise exception 'F24 score 100 rejected'; end if;

  -- F25-F27: null / unknown inputs match nothing
  if {S}.complete_voice_scoring(r6, null, 50, 'x') then raise exception 'F25 null token complete accepted'; end if;
  if {S}.fail_voice_scoring(r6, null, 'x') then raise exception 'F26 null token fail accepted'; end if;
  select * into c from {S}.claim_voice_scoring(null);
  if c.claimed then raise exception 'F27 null id claimed'; end if;
  select * into c from {S}.claim_voice_scoring(gen_random_uuid());
  if c.claimed then raise exception 'F28 unknown id claimed'; end if;

  -- F29: success after failure with the old token is rejected
  select * into c from {S}.claim_voice_scoring(r6);
  t1 := c.lease_token;
  if not {S}.fail_voice_scoring(r6, t1, 'boom') then raise exception 'F29a fail rejected'; end if;
  if {S}.complete_voice_scoring(r6, t1, 60, 'late success') then
    raise exception 'F29 complete accepted after the lease was released by fail'; end if;

  -- F30: retry path - a failed row can be claimed again and scored
  select * into c from {S}.claim_voice_scoring(r6);
  if not c.claimed or c.lease_token = t1 then raise exception 'F30a failed row not re-claimable'; end if;
  if not {S}.complete_voice_scoring(r6, c.lease_token, 60, 'retry ok') then raise exception 'F30 retry score rejected'; end if;
  select * into v from {S}.voice_explanations where id = r6;
  if v.status <> 'scored' or v.communication_score <> 60 then raise exception 'F30b retry not saved'; end if;

  raise notice 'Step 6DD rehearsal: all 30 behaviour checks passed (F1-F30).';
end $$;

rollback;
"""


ORIG45 = (ROOT / "migration/45-voice-scoring-lease-token.sql").read_text(encoding="utf-8")
orig_body = ORIG45.split("\nbegin;\n", 1)[1].split("\ncommit;", 1)[0]
for a, b in [("public.voice_explanations", f"{S}.voice_explanations"),
             ("public.claim_voice_scoring", f"{S}.claim_voice_scoring"),
             ("public.complete_voice_scoring", f"{S}.complete_voice_scoring"),
             ("public.fail_voice_scoring", f"{S}.fail_voice_scoring"),
             ("set search_path to 'public', 'pg_temp'", f"set search_path to '{S}', 'pg_temp'")]:
    orig_body = orig_body.replace(a, b)
REPRO = f"""begin;
create schema {S};
create table {S}.voice_explanations (
  id uuid primary key, status text not null default 'recorded' check (status in ('recorded', 'scored', 'failed')),
  communication_score integer, communication_notes text, scoring_claimed_at timestamptz);
-- ORIGINAL migration 45 statements (unfixed), schema moved
{orig_body}
do $$
declare r uuid := gen_random_uuid(); c record; c2 record; ok boolean; v record;
begin
  insert into {S}.voice_explanations (id) values (r);
  select * into c from {S}.claim_voice_scoring(r);
  perform {S}.complete_voice_scoring(r, c.lease_token, 70, 'good');
  select * into v from {S}.voice_explanations where id = r;
  raise notice 'REPRO after complete: status=% score=% token_kept=%', v.status, v.communication_score, v.scoring_lease_token = c.lease_token;
  ok := {S}.complete_voice_scoring(r, c.lease_token, 5, 'overwrite attempt');
  select * into v from {S}.voice_explanations where id = r;
  raise notice 'REPRO repeated complete accepted=% -> status=% score=% notes=%', ok, v.status, v.communication_score, v.communication_notes;
  ok := {S}.fail_voice_scoring(r, c.lease_token, 'late fail after success');
  select * into v from {S}.voice_explanations where id = r;
  raise notice 'REPRO late fail accepted=% -> status=% score=% claimed_at=% token=%', ok, v.status, v.communication_score, v.scoring_claimed_at, v.scoring_lease_token;
  r := gen_random_uuid();
  insert into {S}.voice_explanations (id) values (r);
  select * into c from {S}.claim_voice_scoring(r);
  select * into c2 from {S}.claim_voice_scoring(r, -5);
  raise notice 'REPRO TTL -5 took over a live claim=% (TTL 0 does the same across transactions; within one transaction now() is fixed)', c2.claimed;
  ok := {S}.complete_voice_scoring(r, c2.lease_token, 150, 'out of range');
  select * into v from {S}.voice_explanations where id = r;
  raise notice 'REPRO score 150 accepted=% -> score=%', ok, v.communication_score;
end $$;
rollback;
"""


def to_scratch(sql: str) -> str:
    for a, b in [
        ("public.voice_explanations", f"{S}.voice_explanations"),
        ("public.claim_voice_scoring", f"{S}.claim_voice_scoring"),
        ("public.complete_voice_scoring", f"{S}.complete_voice_scoring"),
        ("public.fail_voice_scoring", f"{S}.fail_voice_scoring"),
        ("public.guard_voice_explanations_insert", f"{S}.guard_voice_explanations_insert"),
        ("'public'::regnamespace", f"'{S}'::regnamespace"),
        ("table_schema = 'public'", f"table_schema = '{S}'"),
        ("set search_path to 'public', 'pg_temp'", f"set search_path to '{S}', 'pg_temp'"),
        ("'search_path=public, pg_temp'", f"'search_path={S}, pg_temp'"),
    ]:
        assert a in sql, a
        sql = sql.replace(a, b)
    # the PUBLIC role in revoke must stay PUBLIC
    assert "from public, anon, authenticated" in sql
    assert "public." not in sql.replace("from public, anon", ""), "unmoved public.* reference"
    return sql


body = to_scratch(PROD)
head, rest = body.split("\nbegin;\n", 1)
rest, tail = rest.split("\ncommit;\nnotify pgrst, 'reload schema';", 1)
proxy = head + "\n" + SETUP + rest + FUNCTIONAL

# negative proof: same run with one bad grant injected before the post-check
marker = "-- ============================================================\n-- fail-closed verification"
assert rest.count(marker) == 1
bad_rest = rest.replace(marker, f"grant execute on function {S}.complete_voice_scoring(uuid, uuid, integer, text) to anon;\n\n" + marker)
negative = head + "\n" + SETUP + bad_rest + "\nrollback;\n"

# negative proof 2: the complete guard removed must abort at the post-check
guard = "\n     and status <> 'scored';  -- Step 6DD fix: a saved score is final"
assert rest.count(guard) == 1
negative2 = head + "\n" + SETUP + rest.replace(guard, ";") + "\nrollback;\n"

# negative proof 3: FORCE RLS on the table must abort at the pre-check
negative3 = head + "\n" + SETUP + f"alter table {S}.voice_explanations force row level security;\n" + rest + "\nrollback;\n"

# rollback script, moved to the throwaway schema
RB = (ROOT / "migration/step6dd-migration-45-rollback.sql").read_text(encoding="utf-8")
for a, b in [("public.voice_explanations", f"{S}.voice_explanations"),
             ("public.claim_voice_scoring", f"{S}.claim_voice_scoring"),
             ("public.complete_voice_scoring", f"{S}.complete_voice_scoring"),
             ("public.fail_voice_scoring", f"{S}.fail_voice_scoring"),
             ("'public'::regnamespace", f"'{S}'::regnamespace"),
             ("set search_path to 'public', 'pg_temp'", f"set search_path to '{S}', 'pg_temp'")]:
    assert a in RB, a
    RB = RB.replace(a, b)
rb_body = RB.split("\nbegin;\n", 1)[1].split("\ncommit;", 1)[0]
assert "public." not in rb_body.replace("from public, anon", "")
AFTER_RB = f"""
do $$ begin
  if pg_get_function_result('{S}.claim_voice_scoring(uuid, integer)'::regprocedure) <> 'boolean' then
    raise exception 'RB check: claim is not back to 44 shape'; end if;
  raise notice 'Step 6DD rollback rehearsal: database is back at the 44 shape.';
end $$;
rollback;
"""
# B6: fixed 45 applied, then rollback -> back to 44
rb_ok = head + "\n" + SETUP + rest + "\n" + rb_body + AFTER_RB
# B7: UNFIXED original 45 applied, then rollback -> must refuse at its pre-check
rb_refuse = head + "\n" + SETUP + "\ndrop function " + S + ".claim_voice_scoring(uuid, integer);\n" + orig_body + "\n" + rb_body + "\nrollback;\n"

out = ROOT / "migration/step6dd-migration-45-staging-rehearsal-proxy.sql"
out.write_text("-- GENERATED by scripts/dev-tools/step6dd_build_rehearsal.py - do not edit.\n"
               "-- Staging rehearsal of step6dd-migration-45-production-execution.sql in a\n"
               "-- throwaway schema. Always ends in ROLLBACK.\n" + proxy, encoding="utf-8")

FP = ("select p.proname, oidvectortypes(p.proargtypes), pg_get_function_result(p.oid), "
      "md5(p.prosrc), p.proacl::text, p.proowner::regrole from pg_proc p "
      "where p.pronamespace='public'::regnamespace and p.proname in "
      "('claim_voice_scoring','complete_voice_scoring','fail_voice_scoring') order by 1;")


def heredoc(name, text):
    return f"cat > /tmp/{name} <<'SQL_EOF_6DD'\n{text}\nSQL_EOF_6DD\n"


bash = (
    heredoc("prod.sql", PROD) + heredoc("proxy.sql", proxy) + heredoc("neg.sql", negative)
    + heredoc("verify.sql", VERIFY) + heredoc("repro.sql", REPRO) + heredoc("neg2.sql", negative2)
    + heredoc("neg3.sql", negative3) + heredoc("rb_ok.sql", rb_ok) + heredoc("rb_refuse.sql", rb_refuse)
    + 'P() { psql "$STAGING_DB_URI" "$@"; }\n'
    + 'echo "=== 0 server"; P -t -c "select version(), current_user"\n'
    + 'echo "=== R reproduce race on ORIGINAL 45 (throwaway schema, rollback)"; P -v ON_ERROR_STOP=1 -f /tmp/repro.sql; echo "R exit=$?"\n'
    + f'echo "=== A1 fingerprint BEFORE"; P -t -c "{FP}"\n'
    + 'echo "=== A2 exact production script (must abort at pre-check)"; P -v ON_ERROR_STOP=1 -f /tmp/prod.sql; echo "A2 exit=$?"\n'
    + f'echo "=== A3 fingerprint AFTER"; P -t -c "{FP}"\n'
    + 'echo "=== B1 proxy happy path + behaviour"; P -v ON_ERROR_STOP=1 -f /tmp/proxy.sql; echo "B1 exit=$?"\n'
    + 'echo "=== B2 proxy with a bad anon grant (must abort at post-check)"; P -v ON_ERROR_STOP=1 -f /tmp/neg.sql; echo "B2 exit=$?"\n'
    + 'echo "=== B4 proxy with the complete guard removed (must abort at post-check)"; P -v ON_ERROR_STOP=1 -f /tmp/neg2.sql; echo "B4 exit=$?"\n'
    + 'echo "=== B5 proxy with FORCE RLS (must abort at pre-check)"; P -v ON_ERROR_STOP=1 -f /tmp/neg3.sql; echo "B5 exit=$?"\n'
    + 'echo "=== B6 fixed 45 then rollback script (must return to 44)"; P -v ON_ERROR_STOP=1 -f /tmp/rb_ok.sql; echo "B6 exit=$?"\n'
    + 'echo "=== B7 rollback on UNFIXED original 45 (must refuse)"; P -v ON_ERROR_STOP=1 -f /tmp/rb_refuse.sql; echo "B7 exit=$?"\n'
    + f'echo "=== B3 scratch schema left behind (must be 0)"; P -t -c "select count(*) from pg_namespace where nspname=\'{S}\'"\n'
    + 'echo "=== C read-only verification against staging (already at 45)"; P -f /tmp/verify.sql; echo "C exit=$?"\n'
    + 'echo "=== END"\n'
)
payload = base64.b64encode(gzip.compress(bash.encode())).decode()
(ROOT / ".step6dd_payload.txt").write_text(payload)
print(len(payload), "bytes of payload written to .step6dd_payload.txt (not committed)")
