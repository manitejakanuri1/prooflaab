-- 48: optional code scratchpad on written (rubric) tasks.
--
-- A written programming task may show a small "try your code" box on the
-- student's screen. Whether it does is an explicit setting, never a guess from
-- the question's words: task_rubric_config.scratch_language.
--   NULL        -> no scratchpad (every existing row, and every non-code task)
--   one of the code runner's 8 languages -> that language's scratchpad
-- The scratchpad only calls the existing run-code function. Nothing typed in
-- it is saved, submitted or graded; written grading is unchanged.
--
-- A Lot template's config is shared by every student's copy of that Lot. The
-- generic fallback config (is_generic_fallback) is shared by unrelated tasks
-- and must never get a language; the admin screen refuses it.
--
-- Changes:
--   1. task_rubric_config.scratch_language text NULL + CHECK (8 languages).
--   2. rubric_task_view(uuid) also returns scratch_language. Same body
--      otherwise; ownership, SECURITY DEFINER, search_path and EXECUTE grants
--      are kept exactly (CREATE OR REPLACE keeps the ACL; checked below).
-- Not changed: RLS, policies, table grants, grading, submissions, any row.
--
-- Fail-closed: stops before changing anything if the live rubric_task_view is
-- not the known stage70d body (md5 2bbfc156...) or this migration's own body
-- (safe re-run).

begin;

do $$
declare
  body_md5 text;
begin
  select md5(prosrc) into body_md5 from pg_proc
   where oid = 'public.rubric_task_view(uuid)'::regprocedure;
  if body_md5 is null then
    raise exception '48: rubric_task_view(uuid) not found';
  end if;
  if body_md5 not in ('2bbfc1564e363036af161c2fd0a0eba0', '3d7d233c03865938b6238c7925ed0be9') then
    raise exception '48: rubric_task_view body is not the expected stage70d version (md5 %) - stopping, nothing changed', body_md5;
  end if;
end $$;

-- What the function looked like before, to prove nothing but the body changed.
create temp table m48_before on commit drop as
select p.proacl::text as acl, p.prosecdef, p.proconfig::text as cfg, p.proowner, p.provolatile,
       pg_get_function_result(p.oid) as result
  from pg_proc p where p.oid = 'public.rubric_task_view(uuid)'::regprocedure;

create temp table m48_rows on commit drop as
select count(*) as n from public.task_rubric_config;

alter table public.task_rubric_config add column if not exists scratch_language text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.task_rubric_config'::regclass
                    and conname = 'task_rubric_config_scratch_language_check') then
    alter table public.task_rubric_config
      add constraint task_rubric_config_scratch_language_check
      check (scratch_language is null
             or scratch_language in ('python', 'javascript', 'java', 'c', 'cpp', 'go', 'ruby', 'php'));
  end if;
end $$;

comment on column public.task_rubric_config.scratch_language is
  'Language of the optional try-your-code box on this written task (run-code runner languages). NULL = no box. Never set on the generic fallback config. Scratch code is never saved or graded.';

create or replace function public.rubric_task_view(_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'prompt_text', c.prompt_text,
    'criteria', c.criteria,
    'min_words', c.min_words,
    'max_words', c.max_words,
    'pass_threshold', c.pass_threshold,
    'scratch_language', c.scratch_language,
    'completed', exists (
      select 1 from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid() and s.status = 'passed'),
    'pending_review', exists (
      select 1 from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid() and s.status = 'needs_review'),
    'attempts', (
      select count(*) from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid())
  )
  from public.tasks t
  join public.task_rubric_config c on c.id = t.rubric_config_id
  where t.id = _task_id
    and (t.student_id = auth.uid()
         or exists (select 1 from public.task_assignments a
                     where a.task_id = t.id and a.student_id = auth.uid()));
$$;

-- Self-checks: any failure rolls the whole migration back.
do $$
declare
  b record;
  a record;
  bad_row_count bigint;
  sample_id uuid;
begin
  select * into b from m48_before;
  select p.proacl::text as acl, p.prosecdef, p.proconfig::text as cfg, p.proowner, p.provolatile,
         pg_get_function_result(p.oid) as result, md5(p.prosrc) as body_md5
    into a
    from pg_proc p where p.oid = 'public.rubric_task_view(uuid)'::regprocedure;

  if a.body_md5 <> '3d7d233c03865938b6238c7925ed0be9' then
    raise exception '48 check: new rubric_task_view body md5 % is not the expected one', a.body_md5;
  end if;
  if a.acl is distinct from b.acl or a.prosecdef is distinct from b.prosecdef or a.cfg is distinct from b.cfg
     or a.proowner is distinct from b.proowner or a.provolatile is distinct from b.provolatile
     or a.result is distinct from b.result then
    raise exception '48 check: rubric_task_view grants/owner/security/search_path changed';
  end if;
  if not a.prosecdef or a.cfg is distinct from '{"search_path=public, pg_temp"}' then
    raise exception '48 check: rubric_task_view must stay SECURITY DEFINER with search_path public, pg_temp (got %)', a.cfg;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'task_rubric_config'
                    and column_name = 'scratch_language' and data_type = 'text' and is_nullable = 'YES') then
    raise exception '48 check: scratch_language column missing or not nullable text';
  end if;
  if (select count(*) from public.task_rubric_config) <> (select n from m48_rows) then
    raise exception '48 check: row count changed';
  end if;
  select count(*) into bad_row_count from public.task_rubric_config
   where scratch_language is not null
     and scratch_language not in ('python', 'javascript', 'java', 'c', 'cpp', 'go', 'ruby', 'php');
  if bad_row_count > 0 then
    raise exception '48 check: % rows hold an invalid scratch_language', bad_row_count;
  end if;
  if exists (select 1 from public.task_rubric_config where is_generic_fallback and scratch_language is not null) then
    raise exception '48 check: the generic fallback config must not have a scratch_language';
  end if;

  -- The CHECK really rejects a bad value (tried on one row, always undone).
  select id into sample_id from public.task_rubric_config limit 1;
  if sample_id is not null then
    begin
      update public.task_rubric_config set scratch_language = 'cobol' where id = sample_id;
      raise exception '48 check: an invalid scratch_language was accepted';
    exception when check_violation then
      null;  -- expected
    end;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_rubric_config'
                    and policyname = 'task_rubric_config_admin_all') then
    raise exception '48 check: admin policy on task_rubric_config missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.task_rubric_config'::regclass) then
    raise exception '48 check: RLS on task_rubric_config is off';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
