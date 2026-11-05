-- Rollback of 216: gives daily_marks and season_champions back to postgres.
-- This brings the bug back: weekly scoring and the season champion stop saving on REAL.
-- Apply on REAL as postgres (gcloud sql import).
begin;

do $m$
begin
  if not exists (select 1 from pg_roles where rolname = 'prooflab_app') then
    raise notice '216 rollback: no prooflab_app role on this database. Nothing to do.';
    return;
  end if;
  alter table public.daily_marks owner to postgres;
  alter table public.season_champions owner to postgres;
  if exists (select 1 from pg_class
              where oid in ('public.daily_marks'::regclass, 'public.season_champions'::regclass)
                and (relowner <> 'postgres'::regrole or not relrowsecurity)) then
    raise exception '216 rollback: tables do not have the expected owner and row rules';
  end if;
end $m$;

commit;
