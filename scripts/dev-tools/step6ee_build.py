"""Step 6EE: build the migration 46 production files and the staging rehearsal.

No database access. Writes:
  migration/step6ee-migration-46-production-execution.sql
  migration/step6ee-migration-46-rollback.sql
  migration/step6ee-migration-46-staging-rehearsal.sql   (what staging runs)
and .step6ee_payload.txt (bash for the prooflab-staging-inspect4 job, not committed).

Why rebuilt instead of running migration/46-recruiter-provenance-filter.sql:
46 was written from stage35c's recruiter_talent. stage69 later changed that
function (proofs_verified also counts passed task_submissions). Running 46
as written would silently undo stage69.

Starting point = the ACTUAL production definitions, exported by the owner on
2026-09-28 (migration/step6ee-production-before/*.sql, pg_get_functiondef
output). Their executable SQL equals stage69 recruiter_talent / stage35c
recruiter_proof_profile; only comments differ. The filter is added to them
and nothing else changes.
"""
import base64, gzip, hashlib, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
S69 = (ROOT / "supabase/migrations/20261001000700_stage69_sandbox_tasks.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
S35 = (ROOT / "supabase/migrations/20260903000200_stage35c_talent_and_proof_profile.sql").read_text(encoding="utf-8").replace("\r\n", "\n")


def fn(text, start, delim):
    """(header up to and incl. the opening delimiter, body between delimiters)."""
    i = text.index(start)
    a = text.index(delim, i) + len(delim)
    b = text.index(delim, a)
    return text[i:a], text[a:b]


def norm_md5(s):
    return hashlib.md5(re.sub(r"\s+", " ", s).strip().encode()).hexdigest()


def sub1(s, a, b):
    assert s.count(a) == 1, (s.count(a), a)
    return s.replace(a, b)


PB = ROOT / "migration/step6ee-production-before"
T_DEF = (PB / "recruiter_talent.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
P_DEF = (PB / "recruiter_proof_profile.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
T_HEAD, T_OLD = fn(T_DEF, "CREATE OR REPLACE FUNCTION public.recruiter_talent(", "$function$")
P_HEAD, P_OLD = fn(P_DEF, "CREATE OR REPLACE FUNCTION public.recruiter_proof_profile(", "$function$")
# the export must be exactly what production reported
assert norm_md5(T_OLD) == "b47030abb6be083cb964efa247e98eb6", norm_md5(T_OLD)
assert norm_md5(P_OLD) == "642189a0d9c35aaeeabf4a622037194a", norm_md5(P_OLD)
# and its executable SQL must equal the repo's stage69 / stage35c versions
_, T_REPO = fn(S69, "create or replace function public.recruiter_talent(", "$$")
_, P_REPO = fn(S35, "create or replace function public.recruiter_proof_profile(", "$fn$")


def code(s):
    return re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", s)).strip()


assert code(T_OLD) == code(T_REPO), "production recruiter_talent logic differs from stage69"
assert code(P_OLD) == code(P_REPO), "production recruiter_proof_profile logic differs from stage35c"

T_NEW = sub1(T_OLD,
    "             where v.student_id = c.id and v.communication_score is not null) as comms_score,",
    "             where v.student_id = c.id and v.communication_score is not null\n"
    "               -- Step 6H/6EE: only a server-transcribed explanation counts\n"
    "               -- toward the score a recruiter sees and filters on.\n"
    "               and v.transcript_source = 'server') as comms_score,")
P_NEW = sub1(P_OLD,
    "         where ve.student_id = p.id and ve.communication_score is not null\n",
    "         where ve.student_id = p.id and ve.communication_score is not null\n"
    "           -- Step 6H/6EE: same provenance gate as recruiter_talent.comms_score\n"
    "           and ve.transcript_source = 'server'\n")
P_NEW = sub1(P_NEW,
    "                       where v.student_id = p.id and v.communication_score is not null),",
    "                       where v.student_id = p.id and v.communication_score is not null\n"
    "                         and v.transcript_source = 'server'),")

MD5 = {"t_old": norm_md5(T_OLD), "p_old": norm_md5(P_OLD), "t_new": norm_md5(T_NEW), "p_new": norm_md5(P_NEW)}
# the original migration 46 body, to prove what it would have regressed
M46 = (ROOT / "migration/46-recruiter-provenance-filter.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
M46_T_HEAD, M46_T = fn(M46, "create or replace function public.recruiter_talent(", "$fn$")
MD5["t_m46"] = norm_md5(M46_T)

TALENT_SIG = "public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)"
PROFILE_SIG = "public.recruiter_proof_profile(uuid)"
TALENT_RESULT = ("TABLE(student_id uuid, full_name text, branch text, batch text, target_role text, "
                 "total_xp integer, trust_score numeric, skills_proven bigint, skills_total bigint, "
                 "top_skills text[], lots_done bigint, proofs_verified bigint, comms_score integer, "
                 "explanations bigint, days_since_active integer, active_weeks bigint, squad_name text, "
                 "squad_rank integer, season_points integer, shortlisted boolean, total_matches bigint)")
NORM = "md5(btrim(regexp_replace(prosrc, '\\s+', ' ', 'g')))"


def create_talent(body):
    return T_HEAD + body + "$function$;\n"


def create_profile(body):
    return P_HEAD + body + "$function$;\n"


def checks_fn(label, t_md5, p_md5):
    return f"""
  -- both functions carry the expected {label} bodies (whitespace-normalised md5)
  select {NORM} into v from pg_proc where oid = '{TALENT_SIG}'::regprocedure;
  if v <> '{t_md5}' then
    raise exception '{label}: recruiter_talent body md5 is % (expected {t_md5})', v;
  end if;
  select {NORM} into v from pg_proc where oid = '{PROFILE_SIG}'::regprocedure;
  if v <> '{p_md5}' then
    raise exception '{label}: recruiter_proof_profile body md5 is % (expected {p_md5})', v;
  end if;"""


PRE = f"""do $$
declare v text;
begin
  -- exactly one of each, with the expected signatures and return types
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'recruiter_talent') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'recruiter_proof_profile') <> 1 then
    raise exception 'pre-check: expected exactly one recruiter_talent and one recruiter_proof_profile';
  end if;
  if to_regprocedure('{TALENT_SIG}') is null or to_regprocedure('{PROFILE_SIG}') is null then
    raise exception 'pre-check: recruiter_talent / recruiter_proof_profile signature not found';
  end if;
  if pg_get_function_result('{TALENT_SIG}'::regprocedure) <> '{TALENT_RESULT}' then
    raise exception 'pre-check: recruiter_talent return type differs: %', pg_get_function_result('{TALENT_SIG}'::regprocedure);
  end if;
  if pg_get_function_result('{PROFILE_SIG}'::regprocedure) <> 'jsonb' then
    raise exception 'pre-check: recruiter_proof_profile does not return jsonb';
  end if;

  -- already applied? (either the original 46 body or this one)
  if (select position('transcript_source' in prosrc) from pg_proc where oid = '{TALENT_SIG}'::regprocedure) > 0
     or (select position('transcript_source' in prosrc) from pg_proc where oid = '{PROFILE_SIG}'::regprocedure) > 0 then
    raise exception 'pre-check: a transcript_source filter is already present - migration 46 (or a version of it) is already applied; refusing';
  end if;
{checks_fn("pre-check", MD5["t_old"], MD5["p_old"])}

  -- CREATE OR REPLACE keeps the owner; only the owner (or a member) may replace
  if not pg_has_role(current_user, (select proowner from pg_proc where oid = '{TALENT_SIG}'::regprocedure), 'MEMBER')
     or not pg_has_role(current_user, (select proowner from pg_proc where oid = '{PROFILE_SIG}'::regprocedure), 'MEMBER') then
    raise exception 'pre-check: % does not own recruiter_talent / recruiter_proof_profile', current_user;
  end if;

  -- objects the new bodies read must exist
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'voice_explanations' and column_name = 'transcript_source') then
    raise exception 'pre-check: voice_explanations.transcript_source missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.voice_explanations'::regclass
                  and contype = 'c' and pg_get_constraintdef(oid) like '%transcript_source%'
                  and pg_get_constraintdef(oid) like '%''server''%') then
    raise exception 'pre-check: no CHECK on voice_explanations.transcript_source allowing ''server''';
  end if;
  if to_regclass('public.task_submissions') is null then
    raise exception 'pre-check: task_submissions (stage69) missing';
  end if;
  if to_regprocedure('public.my_recruiter_id()') is null or to_regprocedure('public.is_verified_recruiter()') is null
     or to_regprocedure('public.student_is_discoverable(uuid)') is null then
    raise exception 'pre-check: recruiter helper functions missing';
  end if;
  raise notice 'Step 6EE pre-checks passed: current bodies are the exported production pre-46 bodies.';
end $$;
"""

SNAPSHOT = """-- snapshot every public function (body + ACL + owner) to prove afterwards
-- that only the two intended functions changed
create temp table _s6ee_before on commit drop as
  select p.oid, p.proname, md5(p.prosrc) as src_md5, p.proacl::text as acl, p.proowner,
         p.prosecdef, p.proconfig
    from pg_proc p where p.pronamespace = 'public'::regnamespace;
"""

GRANTS = f"""-- permissions: recruiter-facing, so signed-in users only (stage35c's intent:
-- revoke from public, anon; grant to authenticated). Both functions check
-- is_verified_recruiter() themselves.
revoke execute on function {TALENT_SIG}, {PROFILE_SIG} from public, anon;
grant execute on function {TALENT_SIG}, {PROFILE_SIG} to authenticated;
"""

POST = f"""do $$
declare v text; r record;
begin
{checks_fn("post-check", MD5["t_new"], MD5["p_new"])}
  if (select position('task_submissions' in prosrc) from pg_proc where oid = '{TALENT_SIG}'::regprocedure) = 0 then
    raise exception 'post-check: stage69 task_submissions count lost from recruiter_talent';
  end if;
  if pg_get_function_result('{TALENT_SIG}'::regprocedure) <> '{TALENT_RESULT}'
     or pg_get_function_result('{PROFILE_SIG}'::regprocedure) <> 'jsonb' then
    raise exception 'post-check: return type changed';
  end if;

  for r in select p.oid, p.proname, p.prosecdef, p.proconfig, p.proowner, p.proacl, b.proowner as old_owner
             from pg_proc p join _s6ee_before b on b.oid = p.oid
            where p.oid in ('{TALENT_SIG}'::regprocedure, '{PROFILE_SIG}'::regprocedure) loop
    if not r.prosecdef then raise exception 'post-check: % not SECURITY DEFINER', r.proname; end if;
    if r.proconfig is null or not ('search_path=public, pg_temp' = any (r.proconfig)) then
      raise exception 'post-check: % search_path not pinned (%)', r.proname, r.proconfig;
    end if;
    if r.proowner <> r.old_owner then raise exception 'post-check: % owner changed', r.proname; end if;
    if not has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'post-check: authenticated lost EXECUTE on %', r.proname; end if;
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      raise exception 'post-check: anon can EXECUTE %', r.proname; end if;
    if exists (select 1 from aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) a where a.grantee = 0) then
      raise exception 'post-check: PUBLIC can EXECUTE %', r.proname; end if;
  end loop;

  -- nothing else changed: every other public function identical, none added or removed
  if exists (select 1 from _s6ee_before b join pg_proc p on p.oid = b.oid
              where b.oid not in ('{TALENT_SIG}'::regprocedure, '{PROFILE_SIG}'::regprocedure)
                and (md5(p.prosrc) <> b.src_md5 or p.proacl::text is distinct from b.acl
                     or p.proowner <> b.proowner)) then
    raise exception 'post-check: another public function changed';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)
     <> (select count(*) from _s6ee_before) then
    raise exception 'post-check: number of public functions changed';
  end if;
  raise notice 'Step 6EE: all fail-closed checks passed. Committing.';
end $$;
"""

HEADER = f"""-- Step 6EE: production execution of migration 46 (recruiter provenance filter).
--
-- PREPARED, NOT APPLIED. Run only after the project owner's explicit approval,
-- manually in Cloud SQL Studio on prooflab-db / database prooflab, as the
-- owner of recruiter_talent and recruiter_proof_profile (expected prooflab_app).
-- Run step6ee-migration-46-production-prereq-readonly.sql FIRST.
--
-- What it does: a recruiter only sees, and filters on, communication scores
-- from explanations with transcript_source = 'server'. No table, row or
-- column is changed. Two functions are replaced.
--
-- DO NOT run migration/46-recruiter-provenance-filter.sql in production:
-- it was written from stage35c's recruiter_talent and would silently undo
-- stage69 (passed auto-graded task_submissions counted in proofs_verified).
-- This script applies the same filter to the CURRENT bodies instead:
--   recruiter_talent        = exported production body + filter (1 place)
--   recruiter_proof_profile = exported production body + filter (2 places)
--   (migration/step6ee-production-before/*.sql: pg_get_functiondef output exported by
--   the owner 2026-09-28; executable SQL identical to stage69 / stage35c, only
--   comments differ. Business logic and comments are kept unchanged.)
-- Generated by scripts/dev-tools/step6ee_build.py (reviewers can re-run it
-- and diff: the bodies come from migration/step6ee-production-before/).
--
-- Fingerprints (md5 of the body with all whitespace runs collapsed to one space):
--   before: recruiter_talent {MD5['t_old']}  recruiter_proof_profile {MD5['p_old']}
--   after:  recruiter_talent {MD5['t_new']}  recruiter_proof_profile {MD5['p_new']}
--   (original, regressing 46 talent body: {MD5['t_m46']})
--
-- Additions beyond the original 46:
--   - pre-checks (exact current bodies, signatures, return types, ownership,
--     not already applied, referenced objects exist)
--   - EXECUTE: revoke from PUBLIC and anon, grant to authenticated (stage35c's
--     intended grants; staging was found with PUBLIC and anon EXECUTE)
--   - post-checks before COMMIT, including "no other public function changed"
--   - lock_timeout 5s; one transaction
"""

PROD = (HEADER + "\nbegin;\n\nset local lock_timeout = '5s';\n\n" + PRE + "\n" + SNAPSHOT + "\n"
        + create_talent(T_NEW) + "\n" + create_profile(P_NEW) + "\n" + GRANTS + "\n" + POST
        + "\ncommit;\nnotify pgrst, 'reload schema';\n")

RB_PRE = f"""do $$
declare v text;
begin
{checks_fn("rollback pre-check", MD5["t_new"], MD5["p_new"])}
  raise notice 'Step 6EE rollback pre-check passed: the Step 6EE bodies are present.';
end $$;
"""
RB_POST = f"""do $$
declare v text;
begin
{checks_fn("rollback post-check", MD5["t_old"], MD5["p_old"])}
  if has_function_privilege('anon', '{TALENT_SIG}'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', '{TALENT_SIG}'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', '{PROFILE_SIG}'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', '{PROFILE_SIG}'::regprocedure, 'EXECUTE')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid in ('{TALENT_SIG}'::regprocedure, '{PROFILE_SIG}'::regprocedure) and a.grantee = 0) then
    raise exception 'rollback post-check: grants are not the tightened ones (authenticated yes; anon, PUBLIC no)';
  end if;
  raise notice 'Step 6EE rollback: bodies restored to the exported production versions, tightened grants kept. Committing.';
end $$;
"""
ROLLBACK = ("""-- Step 6EE: UNDO of step6ee-migration-46-production-execution.sql.
-- Emergency use only, with the project owner's approval. Restores the
-- pre-46 bodies (stage69 recruiter_talent, stage35c recruiter_proof_profile).
-- Grants are left as the execution script set them (authenticated only):
-- re-opening them to anon/PUBLIC is not an improvement.
-- Refuses unless the exact Step 6EE bodies are present.

begin;

set local lock_timeout = '5s';

""" + RB_PRE + "\n" + create_talent(T_OLD) + "\n" + create_profile(P_OLD) + "\n" + RB_POST
            + "\ncommit;\nnotify pgrst, 'reload schema';\n")

(ROOT / "migration/step6ee-migration-46-production-execution.sql").write_text(PROD, encoding="utf-8", newline="\n")
(ROOT / "migration/step6ee-migration-46-rollback.sql").write_text(ROLLBACK, encoding="utf-8", newline="\n")


def body_of(sql):
    return sql.split("\nbegin;\n", 1)[1].split("\ncommit;", 1)[0]


# ---------------- staging rehearsal (all inside BEGIN ... ROLLBACK) ----------------
X = "7d71bff4-1ec2-4778-b26d-9567a416bfac"   # staging student with browser AND server scores
BEHAVIOUR = f"""
-- behaviour: a verified recruiter looks at student X
do $$
declare rid uuid; t record; j jsonb; srv int; allavg int; nsub bigint; cfg uuid; tid uuid; pv_expected bigint;
begin
  -- data setup (no JWT yet = trusted, like a migration)
  select id into rid from public.recruiters limit 1;
  if rid is null then raise exception 'B: no recruiter row on staging'; end if;
  update public.recruiters set verified = true where id = rid;
  update public.student_profiles set status = 'active', profile_visibility = 'public' where id = '{X}';
  update public.student_portfolios set is_public = true where student_id = '{X}';
  select round(avg(communication_score) filter (where transcript_source = 'server'))::int,
         round(avg(communication_score))::int
    into srv, allavg from public.voice_explanations where student_id = '{X}';
  -- one passed auto-graded submission, to prove stage69's count survives
  -- staging has no auto-graded task, so make one (all rolled back)
  insert into public.task_sandbox_config (language, test_cases, reference_solution) values ('python', '[{{"id":"t1","stdin":"","expected_output":"1","visible":true,"weight":1}}]'::jsonb, 'print(1)') returning id into cfg;
  update public.tasks set sandbox_config_id = cfg where id = (select id from public.tasks limit 1) returning id into tid;
  insert into public.task_submissions (student_id, task_id, sandbox_config_id, code, sandbox_score, status)
  values ('{X}', tid, cfg, 'print(1)', 100, 'passed');
  select count(*) into nsub from public.task_submissions where student_id = '{X}' and status = 'passed';
  if nsub < 1 then raise exception 'B: test setup made no passed submission'; end if;

  -- act as that recruiter, the way PostgREST would
  perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role', 'authenticated')::text, true);
  if not public.is_verified_recruiter() then raise exception 'B: recruiter not verified in test'; end if;
  if not public.student_is_discoverable('{X}') then raise exception 'B: student not discoverable in test'; end if;

  select * into t from public.recruiter_talent(_limit => 100) where student_id = '{X}';
  if not found then
    raise exception 'B1: student missing from recruiter_talent (rows returned: %)',
      (select count(*) from public.recruiter_talent(_limit => 100)); end if;
  if t.comms_score is distinct from srv then
    raise exception 'B1: comms_score % (expected server-only average %; browser-inclusive average is %)', t.comms_score, srv, allavg; end if;
  select (select count(*) from public.proof_uploads pu where pu.student_id = '{X}' and pu.status in ('Verified','verified')) + nsub
    into pv_expected;
  if t.proofs_verified <> pv_expected then
    raise exception 'B2: proofs_verified % (expected % = verified proofs + % passed submission(s)) - stage69 lost', t.proofs_verified, pv_expected, nsub; end if;
  if exists (select 1 from public.recruiter_talent(_min_comms => srv + 1) where student_id = '{X}') then
    raise exception 'B3: _min_comms filter used a browser score'; end if;
  if not exists (select 1 from public.recruiter_talent(_min_comms => srv) where student_id = '{X}') then
    raise exception 'B3b: _min_comms filter excluded a qualifying server score'; end if;

  j := public.recruiter_proof_profile('{X}');
  if (j->>'communication')::int is distinct from srv then
    raise exception 'B4: profile communication % (expected %)', j->>'communication', srv; end if;
  if exists (select 1 from jsonb_array_elements(j->'explanations') e
              join public.voice_explanations v on v.id = (e->>'id')::uuid
             where v.transcript_source <> 'server') then
    raise exception 'B5: profile lists a non-server explanation'; end if;

  -- a non-recruiter gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  if exists (select 1 from public.recruiter_talent()) then raise exception 'B6: non-recruiter saw candidates'; end if;
  if (public.recruiter_proof_profile('{X}') ? 'error') is not true then raise exception 'B7: non-recruiter saw a profile'; end if;

  raise notice 'Step 6EE behaviour: comms_score % = server-only average (browser-inclusive would be %), proofs_verified % includes % passed submission(s), filter and profile use server only, non-recruiter blocked. 7/7 passed.',
    srv, allavg, t.proofs_verified, nsub;
end $$;
"""

# restore the pre-46 production shape inside the transaction (never committed)
RESTORE = ("-- REHEARSAL ONLY: put the expected production 'before' bodies in place (rolled back)\n"
           + create_talent(T_OLD) + "\n" + create_profile(P_OLD) + "\n")

RAW = {"t": hashlib.md5(T_OLD.encode()).hexdigest(), "p": hashlib.md5(P_OLD.encode()).hexdigest()}
# rehearsal-only extra checks: byte-exact restore + untouched other grantees
EXACT = f"""
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = '{TALENT_SIG}'::regprocedure) <> '{RAW["t"]}'
     or (select md5(prosrc) from pg_proc where oid = '{PROFILE_SIG}'::regprocedure) <> '{RAW["p"]}' then
    raise exception 'RB-exact: rollback did not restore the exported production bodies byte for byte';
  end if;
  if not has_function_privilege('service_role', '{TALENT_SIG}'::regprocedure, 'EXECUTE')
     or not has_function_privilege('service_role', '{PROFILE_SIG}'::regprocedure, 'EXECUTE') then
    raise exception 'RB-exact: an existing service_role grant was removed';
  end if;
  raise notice 'Step 6EE rollback rehearsal: bodies byte-identical to the production export; service_role grant untouched.';
end $$;
"""
REH_OK = "begin;\n" + RESTORE + body_of(PROD) + BEHAVIOUR + "\n" + body_of(ROLLBACK) + EXACT + "\nrollback;\n"
# original migration 46 body on top of the stage69 state: proves the regression
M46_FULL = (ROOT / "migration/46-recruiter-provenance-filter.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
REH_M46 = ("begin;\n" + RESTORE + body_of(M46_FULL) + f"""
do $$ begin
  raise notice 'ORIGINAL 46 on the stage69 state: recruiter_talent still counts task_submissions = %',
    (select position('task_submissions' in prosrc) > 0 from pg_proc where oid = '{TALENT_SIG}'::regprocedure);
end $$;
rollback;
""")
# negative: a changed "before" body must stop the script at the pre-check
REH_NEG = ("begin;\n" + RESTORE + create_talent(T_OLD.replace("limit 1) as squad_name", "limit 1) as /* drift */ squad_name"))
           + body_of(PROD) + "\nrollback;\n") if "limit 1) as squad_name" in T_OLD else None
assert REH_NEG, "drift marker not found"
# negative: the script must refuse when run again after it applied
REH_TWICE = "begin;\n" + RESTORE + body_of(PROD) + "\n" + body_of(PROD) + "\nrollback;\n"

(ROOT / "migration/step6ee-migration-46-staging-rehearsal.sql").write_text(
    "-- GENERATED by scripts/dev-tools/step6ee_build.py. Staging only. Always ROLLBACK.\n" + REH_OK, encoding="utf-8")

FP = ("select proname, " + NORM.replace("prosrc", "p.prosrc") + ", p.proacl::text from pg_proc p "
      "where p.pronamespace='public'::regnamespace and p.proname in ('recruiter_talent','recruiter_proof_profile') order by 1;")


def heredoc(name, text):
    return f"cat > /tmp/{name} <<'SQL_EOF_6EE'\n{text}\nSQL_EOF_6EE\n"


bash = (heredoc("prod.sql", PROD) + heredoc("ok.sql", REH_OK) + heredoc("m46.sql", REH_M46)
        + heredoc("neg.sql", REH_NEG) + heredoc("twice.sql", REH_TWICE)
        + heredoc("verify.sql", (ROOT / "migration/step6ee-migration-46-production-verify-readonly.sql").read_text(encoding="utf-8"))
        + heredoc("prereq.sql", (ROOT / "migration/step6ee-migration-46-production-prereq-readonly.sql").read_text(encoding="utf-8"))
        + 'P() { psql "$STAGING_DB_URI" "$@"; }\n'
        + 'echo "=== 0"; P -t -c "select version(), current_user"\n'
        + f'echo "=== A1 fingerprint BEFORE"; P -t -c "{FP}"\n'
        + 'echo "=== A2 exact production script on real staging (must abort at pre-check)"; P -v ON_ERROR_STOP=1 -f /tmp/prod.sql; echo "A2 exit=$?"\n'
        + f'echo "=== A3 fingerprint AFTER"; P -t -c "{FP}"\n'
        + 'echo "=== R original 46 on the stage69 state (rollback)"; P -v ON_ERROR_STOP=1 -f /tmp/m46.sql; echo "R exit=$?"\n'
        + 'echo "=== B restore before-state, run script, behaviour, rollback script (all rolled back)"; P -v ON_ERROR_STOP=1 -f /tmp/ok.sql; echo "B exit=$?"\n'
        + 'echo "=== N1 drifted before-body (must abort at pre-check)"; P -v ON_ERROR_STOP=1 -f /tmp/neg.sql; echo "N1 exit=$?"\n'
        + 'echo "=== N2 script run twice (second must abort)"; P -v ON_ERROR_STOP=1 -f /tmp/twice.sql; echo "N2 exit=$?"\n'
        + f'echo "=== A4 fingerprint at END"; P -t -c "{FP}"\n'
        + 'echo "=== C prereq read-only file on staging"; P -f /tmp/prereq.sql; echo "C exit=$?"\n'
        + 'echo "=== D verify read-only file on staging"; P -f /tmp/verify.sql; echo "D exit=$?"\n'
        + 'echo "=== END"\n')
(ROOT / ".step6ee_payload.txt").write_text(base64.b64encode(gzip.compress(bash.encode())).decode())
print(MD5)
