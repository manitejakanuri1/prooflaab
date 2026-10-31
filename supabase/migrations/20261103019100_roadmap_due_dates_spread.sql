-- 191 (MF-076): every roadmap task of one test was due the same day (created + 14 days), so a student saw
-- 3-6 tasks all due "Nov 10". New roadmap tasks now get one stage a week (resume-assessment-submit). This
-- spreads the open ones the same way: stage N is due N+1 weeks after the task was made. Finished tasks are
-- not touched. Old due dates are kept in public.mf076_due_date_backup for the rollback.
begin;
create table if not exists public.mf076_due_date_backup (task_id uuid primary key, due_date timestamptz);
alter table public.mf076_due_date_backup enable row level security;
revoke all on public.mf076_due_date_backup from public, anon, authenticated;

insert into public.mf076_due_date_backup (task_id, due_date)
select id, due_date from public.tasks
 where roadmap_scorecard_id is not null and roadmap_stage_index is not null and status <> 'completed'
on conflict (task_id) do nothing;

update public.tasks t
   set due_date = t.created_at + make_interval(days => 7 * (t.roadmap_stage_index + 1))
  from public.mf076_due_date_backup b
 where b.task_id = t.id and t.status <> 'completed';

do $$
begin
  if exists (select 1 from public.tasks
              where roadmap_scorecard_id is not null and roadmap_stage_index is not null and status <> 'completed'
              group by student_id, roadmap_scorecard_id, due_date::date having count(*) > 1) then
    raise exception '191: a test still has two open roadmap tasks due the same day';
  end if;
end $$;
commit;
