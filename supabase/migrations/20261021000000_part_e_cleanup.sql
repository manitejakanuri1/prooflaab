-- Part E clean-up (owner approved, 20 Sep 2026). Nothing here is used by the
-- website, the functions or the crawler; checked by searching src/, supabase/functions/,
-- functions-service/, crawler/ and scripts/, and by row counts on the live database
-- (0 rows in the four empty tables, 0 filled meet_url). role_track_config (14 rows)
-- was exported first to gs://prooflab-backups-508214/part-e-2026-09-20/.
--
-- No CASCADE on purpose: if anything still depends on one of these, the drop fails,
-- the transaction rolls back and nothing is removed.
begin;

drop function if exists public.claim_crawl_jobs(text, integer);
drop table public.crawl_queue;
drop table public.thread_posts;      -- points at topic_threads, so it goes first
drop table public.topic_threads;
drop table public.activity_logs;
drop table public.role_track_config;
alter table public.squad_members drop column meet_url;

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public'
                and table_name in ('crawl_queue','thread_posts','topic_threads','activity_logs','role_track_config')) then
    raise exception 'a Part E table is still there';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'squad_members' and column_name = 'meet_url') then
    raise exception 'squad_members.meet_url is still there';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'claim_crawl_jobs') then
    raise exception 'claim_crawl_jobs is still there';
  end if;
  -- the tables the product runs on must all still be there
  if (select count(*) from information_schema.tables
       where table_schema = 'public'
         and table_name in ('squads','squad_members','source_content','source_registry','student_profiles','tasks','level_content')) <> 7 then
    raise exception 'a core table is missing';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
