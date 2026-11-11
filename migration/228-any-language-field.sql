-- 228 (owner 12 Nov 2026): the task list says "your code", not "a JavaScript function", on Lots with the language
-- menu. any_language(tasks) is a computed field, so the list asks for it in the same request
-- (select=...,any_language). It uses the one rule from 226 (sandbox_languages). Task text is not changed.
-- Rollback: migration/228-rollback-any-language-field.sql
begin;

create or replace function public.any_language(public.tasks)
returns boolean
language sql
stable
-- Definer: the rule reads task_sandbox_config, which a student cannot read; only a yes/no comes back,
-- and only for a task row the caller can already see.
security definer
set search_path = public, pg_temp
as $$ select coalesce(cardinality(public.sandbox_languages($1.id)) > 1, false) $$;
revoke all on function public.any_language(public.tasks) from public, anon;
grant execute on function public.any_language(public.tasks) to authenticated, service_role;

do $$
declare n int; m int;
begin
  select count(*) filter (where public.any_language(t)), count(*) filter (where t.sandbox_config_id is null and public.any_language(t))
    into n, m from public.tasks t;
  if m <> 0 then raise exception '228 self-check: % written Lots say any language', m; end if;
  if not exists (select 1 from pg_proc where proname = 'any_language' and prosecdef) then
    raise exception '228 self-check: any_language is not security definer';
  end if;
  raise notice '228: % tasks have the language menu', n;
end $$;

notify pgrst, 'reload schema';
commit;
