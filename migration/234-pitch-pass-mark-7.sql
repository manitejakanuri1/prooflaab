-- 234 (owner + Purna 12 Nov 2026, option A): pitch Lots pass at 7/10 (70), not 9/10 (90).
--   1. Every rubric config used by a pitch template or a pitch Lot moves 90 -> 70. Old tries keep their result
--      (option A): task_submissions.status is not touched. The freeze trigger allows a pass-mark change.
--   2. New pitch templates: an AFTER trigger on lot_templates sets the pitch config's pass mark to 70 (the
--      lot-writer's rubric-downgrade path defaults to 90). Non-pitch configs are not changed.
-- Rollback: migration/234-rollback-pitch-pass-mark-7.sql
begin;
create table if not exists public.backup_pitch_pass_20261112 as
  select id, pass_threshold from public.task_rubric_config c
   where c.pass_threshold > 70
     and (exists (select 1 from public.lot_templates t where t.rubric_config_id = c.id and t.lot_category = 'pitch')
          or exists (select 1 from public.tasks t where t.rubric_config_id = c.id and t.lot_category = 'pitch'));
alter table public.backup_pitch_pass_20261112 enable row level security;
update public.task_rubric_config c set pass_threshold = 70, updated_at = now()
  from public.backup_pitch_pass_20261112 b where b.id = c.id;

create or replace function public.pitch_pass_mark() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if new.lot_category = 'pitch' and new.rubric_config_id is not null then
    update public.task_rubric_config set pass_threshold = 70, updated_at = now()
     where id = new.rubric_config_id and pass_threshold > 70;
  end if;
  return new;
end $f$;
drop trigger if exists pitch_pass_mark on public.lot_templates;
create trigger pitch_pass_mark after insert or update of rubric_config_id, lot_category on public.lot_templates
  for each row execute function public.pitch_pass_mark();

do $$
begin
  if exists (select 1 from public.task_rubric_config c join public.lot_templates t on t.rubric_config_id = c.id
              where t.lot_category = 'pitch' and c.pass_threshold > 70) then
    raise exception '234 self-check: a pitch config still passes above 70';
  end if;
end $$;
commit;
