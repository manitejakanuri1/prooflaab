-- Rollback for migration 95.
-- WARNING: dropping this table signs out every BFF browser session.
begin;

drop table if exists public.web_sessions;

do $$
begin
  if to_regclass('public.web_sessions') is not null then
    raise exception '95 rollback self-check: web_sessions still exists';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
