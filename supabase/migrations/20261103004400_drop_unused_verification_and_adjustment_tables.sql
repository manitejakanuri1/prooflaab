-- ##########################################################################
-- 94: drop two tables nothing uses: verification_settings, manual_adjustment_log. PERMANENT.
-- Rehearsed on STAGING (rolled back, 7 Oct 2026). PRODUCTION needs the owner's written yes and a
-- same-hour backup, and goes after 66 (it needs legacy_archive) - so after 66, 71, 72.
-- ##########################################################################
-- verification_settings  per-college pass mark of the proof-era "verification engine"
--                        (Supabase stage3, 16 Aug). The engine and its screens are gone.
-- manual_adjustment_log  admin XP/score adjustment log of the Supabase stage14 admin dashboard
--                        (21 Aug). No screen or function writes or reads it.
-- Evidence (7 Oct 2026, latest main 9678765): no reference in the website, any server function,
-- any Python service, crawler, bug-finder or script (only the generated types.ts and the
-- documentation generator gen_guide_appendix.py, which lists tables by name); on staging no
-- function body, view, other table's policy or foreign key refers to either; 0 rows on staging.
-- What stays: their own trigger/policies/indexes go with them; nothing else changes.
-- Every row (production may have some) is copied to legacy_archive first. The file refuses to run
-- if any function, view, other table's policy or foreign key still depends on either table.
begin;

do $$
declare bad text; n bigint; t text;
begin
  if to_regclass('public.legacy_archive') is null then raise exception '94: apply 66 first'; end if;
  foreach t in array array['verification_settings', 'manual_adjustment_log'] loop
    continue when to_regclass('public.' || t) is null;
    select string_agg(p.oid::regprocedure::text, ', ') into bad
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ ('\m' || t || '\M');
    if bad is not null then raise exception '94: functions still use %: %', t, bad; end if;
    select string_agg(c.relname, ', ') into bad
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('v', 'm') and pg_get_viewdef(c.oid) ~ ('\m' || t || '\M');
    if bad is not null then raise exception '94: views still read %: %', t, bad; end if;
    select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
     where schemaname = 'public' and tablename <> t
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ ('\m' || t || '\M');
    if bad is not null then raise exception '94: policies on other tables still read %: %', t, bad; end if;
    select string_agg(conrelid::regclass || '.' || conname, ', ') into bad from pg_constraint
     where contype = 'f' and confrelid = ('public.' || t)::regclass and conrelid <> ('public.' || t)::regclass;
    if bad is not null then raise exception '94: foreign keys point at %: %', t, bad; end if;

    execute format('insert into public.legacy_archive (source_table, row_data) select %L, to_jsonb(x) from public.%I x', t, t);
    get diagnostics n = row_count;
    raise notice '94: archived % % rows', n, t;
  end loop;
end $$;

drop table if exists public.verification_settings;
drop table if exists public.manual_adjustment_log;

do $$
begin
  if to_regclass('public.verification_settings') is not null or to_regclass('public.manual_adjustment_log') is not null then
    raise exception '94 self-check: a dropped table is still there';
  end if;
  if to_regclass('public.task_submissions') is null or to_regclass('public.student_profiles') is null
     or to_regclass('public.legacy_archive') is null then
    raise exception '94 self-check: a current table went missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
