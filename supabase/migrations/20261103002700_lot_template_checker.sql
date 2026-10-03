-- 77: Lot templates get their own default-checker function (fixes a fault introduced by 74).
-- lot_templates used the same trigger function as tasks. Migration 74 made that function set
-- tasks.grading_type, a column Lot templates do not have, so EVERY new Lot template failed
-- ("record new has no field grading_type") and the nightly Lot-writing job could not claim a
-- new page. Found by the staging crawler end-to-end run before it reached production.
-- 74 and 77 must always be applied together.
begin;

create or replace function public.lot_template_default_checker()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if new.sandbox_config_id is null and new.rubric_config_id is null then
    new.rubric_config_id := (select id from public.task_rubric_config where is_generic_fallback limit 1);
  end if;
  return new;
end $function$;

drop trigger if exists lot_template_default_checker on public.lot_templates;
create trigger lot_template_default_checker before insert on public.lot_templates
  for each row execute function public.lot_template_default_checker();

do $$
declare bad text; sc uuid; made boolean := false;
begin
  -- No other table may still use the tasks-only function.
  select string_agg(c.relname, ', ') into bad
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where t.tgfoid = 'public.task_default_checker()'::regprocedure and c.relname <> 'tasks';
  if bad is not null then raise exception '77 self-check: task_default_checker is still attached to: %', bad; end if;

  -- A new Lot template can be created again.
  select s.id into sc from public.source_content s
   where not exists (select 1 from public.lot_templates l where l.source_content_id = s.id) limit 1;
  if sc is not null then
    perform public.seed_lot_template(sc);
    if not exists (select 1 from public.lot_templates where source_content_id = sc and rubric_config_id is not null) then
      raise exception '77 self-check: a seeded Lot template did not get a checker';
    end if;
    delete from public.lot_templates where source_content_id = sc and origin = 'seed';
  end if;
end $$;

commit;
