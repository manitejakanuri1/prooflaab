-- ##########################################################################
-- 71: drop the two columns nothing uses any more. PERMANENT.
-- Rehearsed on STAGING. PRODUCTION needs the owner's written yes and a same-hour backup,
-- and goes after 66 (the proof table is already gone) and after the website and functions
-- of this branch are live: OLDER recorder builds still select and insert proof_id.
-- ##########################################################################
--   voice_explanations.proof_id   - the link to a proof upload. A recording belongs to a
--                                   submission (migration 61). Callers searched: website
--                                   (no select/insert left), transcription-enqueue (does
--                                   not write it), database functions (only the insert
--                                   guard, rewritten here), views, policies, indexes.
--   student_portfolios.projects   - never read or written by current code (the portfolio
--                                   is portfolio_work(), migration 63).
-- Any non-empty value is copied to legacy_archive first.
begin;

do $$
declare bad text;
begin
  if to_regclass('public.legacy_archive') is null then
    raise exception '71: legacy_archive is missing - apply 66 first';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'guard_voice_explanations_insert'
     and (p.prosrc ~ '\mproof_id\M' or (p.prosrc ~ 'student_portfolios' and p.prosrc ~ '\mprojects\M'));
  if bad is not null then raise exception '71: functions still use the columns: %', bad; end if;
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm') and pg_get_viewdef(c.oid) ~ '\mproof_id\M';
  if bad is not null then raise exception '71: views still use proof_id: %', bad; end if;
  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
   where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ '\mproof_id\M';
  if bad is not null then raise exception '71: policies still use proof_id: %', bad; end if;

  insert into public.legacy_archive (source_table, row_data)
  select 'voice_explanations.proof_id', jsonb_build_object('voice_id', id, 'proof_id', proof_id)
    from public.voice_explanations where proof_id is not null;
  insert into public.legacy_archive (source_table, row_data)
  select 'student_portfolios.projects', jsonb_build_object('portfolio_id', id, 'student_id', student_id, 'projects', projects)
    from public.student_portfolios
   where projects is not null and projects::text not in ('[]', '{}', 'null');
end $$;

-- The insert guard no longer mentions the column.
create or replace function public.guard_voice_explanations_insert()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.student_id = new.student_id
  ) then
    raise exception 'task_id does not belong to this student';
  end if;
  new.transcript_source := 'browser';
  new.status := 'recorded';
  new.communication_score := null;
  new.communication_notes := null;
  new.word_count := case
    when new.transcript is not null and length(trim(new.transcript)) > 0
    then array_length(regexp_split_to_array(trim(new.transcript), '\s+'), 1)
    else 0
  end;
  new.transcription_status := 'completed';
  new.transcription_idempotency_key := null;
  new.transcription_claimed_at := null;
  new.transcription_attempts := 0;
  new.transcription_error := null;
  new.transcription_lease_token := null;
  new.transcription_enqueued_at := null;
  new.transcription_reap_claimed_at := null;
  new.transcription_reap_attempts := 0;
  return new;
end $function$;

-- No CASCADE: an unexpected dependent makes this fail and roll back.
alter table public.voice_explanations drop column proof_id;
alter table public.student_portfolios drop column projects;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'voice_explanations' and column_name = 'proof_id')
                or (table_name = 'student_portfolios' and column_name = 'projects'))) then
    raise exception '71 self-check: a column is still there';
  end if;
  if pg_get_functiondef('public.guard_voice_explanations_insert()'::regprocedure) ~ 'proof_id' then
    raise exception '71 self-check: the insert guard still mentions proof_id';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
