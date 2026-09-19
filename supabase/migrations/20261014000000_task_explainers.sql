-- "Explained simply" (owner's request, 19 Sep 2026): before any task a student
-- sees the question retold in child-simple words - what it asks, the steps, a
-- tiny example, hard words explained, how to know you are done.
-- Written once per distinct task text (key = sha256 of title + description)
-- and kept forever, so 22 students on the same Lot share one write.
-- Only the task-explain function (service_role) reads or writes it.
begin;

create table if not exists public.task_explainers (
  key        text primary key,
  brief      jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.task_explainers enable row level security;
revoke all on public.task_explainers from public, anon, authenticated;
grant select, insert, update on public.task_explainers to service_role;

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'task_explainers') then
    raise exception 'task_explainers missing';
  end if;
  if has_table_privilege('authenticated', 'public.task_explainers', 'select') then
    raise exception 'students must not read task_explainers directly';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
