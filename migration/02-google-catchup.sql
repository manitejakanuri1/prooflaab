-- Bring the Google database up to the Supabase schema.
--
-- The Google copy was taken before the last few migrations were applied to
-- Supabase, and two of those migrations were applied through the Supabase MCP
-- without ever being saved into supabase/migrations/ - so replaying the folder
-- would not have produced them. The definitions below were read back out of the
-- 12 September backup, which is the only complete record of them.
--
-- What was behind: 14 columns across 5 tables, and one view.
--
-- Safe to run twice. Every statement checks first, so a half-finished run can
-- simply be run again.

begin;

-- ---------------------------------------------------------------------------
-- 1. lot_templates gained its own identity
--
-- It used to be keyed by the level it belonged to, which meant a level could
-- carry exactly one template. stage75 gave it an id of its own and hung it off
-- source_content instead, so the same level can have several.
-- ---------------------------------------------------------------------------

alter table public.lot_templates
  add column if not exists id uuid default gen_random_uuid() not null;

alter table public.lot_templates
  add column if not exists source_content_id uuid;

do $$
begin
  -- level_id was the primary key; it becomes merely unique, and nullable, so a
  -- template can exist without a level.
  if exists (select 1 from pg_constraint
              where conrelid = 'public.lot_templates'::regclass
                and contype = 'p' and conname = 'lot_templates_pkey'
                and pg_get_constraintdef(oid) = 'PRIMARY KEY (level_id)')
  then
    alter table public.lot_templates drop constraint lot_templates_pkey;
    alter table public.lot_templates add constraint lot_templates_pkey primary key (id);
    alter table public.lot_templates alter column level_id drop not null;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lot_templates'::regclass
                    and conname = 'lot_templates_level_id_key')
  then
    alter table public.lot_templates add constraint lot_templates_level_id_key unique (level_id);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lot_templates'::regclass
                    and conname = 'lot_templates_source_content_id_key')
  then
    alter table public.lot_templates
      add constraint lot_templates_source_content_id_key unique (source_content_id);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lot_templates'::regclass
                    and conname = 'lot_templates_source_content_id_fkey')
  then
    alter table public.lot_templates
      add constraint lot_templates_source_content_id_fkey
      foreign key (source_content_id) references public.source_content(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. the smaller additions
-- ---------------------------------------------------------------------------

alter table public.source_content
  add column if not exists grading_mode_hint text;

alter table public.task_rubric_config
  add column if not exists is_generic_fallback boolean default false not null;

alter table public.task_rubric_config
  add column if not exists origin text default 'manual'::text not null;

alter table public.task_sandbox_config
  add column if not exists origin text default 'manual'::text not null;

alter table public.tasks
  add column if not exists source_content_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.tasks'::regclass
                    and conname = 'tasks_source_content_id_fkey')
  then
    alter table public.tasks
      add constraint tasks_source_content_id_fkey
      foreign key (source_content_id) references public.source_content(id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. the admin_users view
--
-- Not a table. It is the admin screen's list of administrators, assembled from
-- user_roles and the login records, and it is guarded by is_admin() so a
-- non-administrator selecting from it sees nothing at all.
-- ---------------------------------------------------------------------------

create or replace view public.admin_users as
  select r.id,
         coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''),
                  split_part(u.email::text, '@', 1)) as name,
         u.email,
         r.role::text as role,
         'active'::text as status,
         r.created_at,
         u.last_sign_in_at
    from public.user_roles r
    join auth.users u on u.id = r.user_id
   where r.role = 'admin'::public.app_role
     and public.is_admin();

-- ---------------------------------------------------------------------------
-- 4. prove it worked before committing
-- ---------------------------------------------------------------------------

do $$
declare
  missing text;
begin
  select string_agg(want, ', ')
    into missing
    from (values
      ('lot_templates.id'), ('lot_templates.source_content_id'),
      ('source_content.grading_mode_hint'),
      ('task_rubric_config.is_generic_fallback'), ('task_rubric_config.origin'),
      ('task_sandbox_config.origin'), ('tasks.source_content_id')
    ) as v(want)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name || '.' || column_name = v.want);

  if missing is not null then
    raise exception 'these columns did not get created: %', missing;
  end if;

  if not exists (select 1 from information_schema.views
                  where table_schema = 'public' and table_name = 'admin_users') then
    raise exception 'the admin_users view did not get created';
  end if;

  raise notice 'schema catch-up complete: 7 columns and the admin_users view are present';
end $$;

commit;
