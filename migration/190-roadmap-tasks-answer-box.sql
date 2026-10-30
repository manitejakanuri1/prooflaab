-- 190 (MF-109): roadmap tasks are written tasks (typed answer, no code runner), but the roadmap writer told
-- students to work "in ProofLab's code editor". New roadmap tasks are fixed in code (_shared/roadmap-action.ts
-- turns "code editor" into "the answer box"). This makes the existing roadmap tasks say the same thing.
-- Only roadmap tasks (roadmap_scorecard_id set, no sandbox config) are touched; the old text is kept in
-- public.mf109_task_text_backup so the rollback can put it back.
begin;
create table if not exists public.mf109_task_text_backup (task_id uuid primary key, description text not null);
alter table public.mf109_task_text_backup enable row level security;
revoke all on public.mf109_task_text_backup from public, anon, authenticated;

insert into public.mf109_task_text_backup (task_id, description)
select id, description from public.tasks
 where roadmap_scorecard_id is not null and sandbox_config_id is null and description ~* 'code editor'
on conflict (task_id) do nothing;

update public.tasks t
   set description = regexp_replace(
         regexp_replace(t.description, '(in|using|with)\s+(the\s+)?(prooflab''?s?\s+)?code editor', 'in the answer box', 'gi'),
         '(the\s+)?(prooflab''?s?\s+)?code editor', 'the answer box', 'gi')
  from public.mf109_task_text_backup b
 where b.task_id = t.id and t.description ~* 'code editor';

do $$
begin
  if exists (select 1 from public.tasks where roadmap_scorecard_id is not null and sandbox_config_id is null
              and description ~* 'code editor') then
    raise exception '190: a roadmap task still mentions the code editor';
  end if;
end $$;
commit;
