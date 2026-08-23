-- ============================================================================
-- Stage 29 — the admin's Template tab stops being a prop.
--
-- Assign Tasks has four tabs: Manual, AI, Template, Personalized. The Template
-- tab offered three templates — "Basic Programming Challenge" and two more —
-- hardcoded in the browser with the ids '1', '2' and '3'. Choosing one and
-- pressing Assign sent template_id '1' to assign_tasks, which looks it up in
-- task_templates: a table that has never existed. Every attempt ended in
-- "Template not found".
--
-- The table now exists and the dropdown reads it. Nothing is seeded — a
-- template library with invented entries is the same lie in a different place.
-- Admins fill it by pressing "Save as template" on a task they are already
-- writing.
-- ============================================================================

create table public.task_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null,
  branch      text,
  skills      text[] not null default '{}',
  difficulty  text not null default 'Medium'
                check (difficulty in ('Beginner', 'Medium', 'Advanced')),
  xp_reward   integer not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index task_templates_created_idx on public.task_templates (created_at desc);
create unique index task_templates_no_duplicate_titles on public.task_templates (lower(title));

create trigger task_templates_set_updated_at before update on public.task_templates
  for each row execute function public.set_updated_at();

alter table public.task_templates enable row level security;

-- Admins write them. Colleges may read them, because the same Template tab
-- exists on the college side of the same screen and a shared library is the
-- point of one.
create policy task_templates_read on public.task_templates for select to authenticated
  using ((select public.is_admin())
         or (select public.my_college_id()) is not null);
create policy task_templates_admin_insert on public.task_templates for insert to authenticated
  with check ((select public.is_admin()));
create policy task_templates_admin_update on public.task_templates for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy task_templates_admin_delete on public.task_templates for delete to authenticated
  using ((select public.is_admin()));
