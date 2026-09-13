-- The last differences between Google and Supabase.
--
-- Found by comparing every table, column, view, policy, foreign key, check
-- constraint, trigger, function signature, function BODY, function grant, table
-- grant and row-security flag on both sides - rather than the names-only check
-- that let the stale lot engine through earlier today.
--
-- What was still missing, and why each one matters:
--
--   5 foreign keys   the config columns added in stage71/72 were copied without
--                    the references that go with them. A task could point at a
--                    rubric that had been deleted, and nothing would object.
--
--   2 check rules    origin may only be manual, auto or auto_fallback. Without
--                    them any string was accepted, and the code that branches on
--                    that value would meet a word it does not handle.
--
--   2 triggers       admin_users is a view; these are what make writing to it
--                    do anything. Without them an admin edit vanishes silently -
--                    the update succeeds and nothing changes.
--
--   6 grants         service_role could read admin_users but not write it, so
--                    the same edit would have failed even with the triggers.
--
-- Every one of these is the same shape of fault: an object was copied without
-- the thing attached to it. A column without its constraint, a view without its
-- triggers, a trigger without its grant.

begin;

-- ---------------------------------------------------------------------------
-- 1. the references that belong to the config columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lot_templates_rubric_config_id_fkey') then
    alter table public.lot_templates add constraint lot_templates_rubric_config_id_fkey
      foreign key (rubric_config_id) references public.task_rubric_config(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'lot_templates_sandbox_config_id_fkey') then
    alter table public.lot_templates add constraint lot_templates_sandbox_config_id_fkey
      foreign key (sandbox_config_id) references public.task_sandbox_config(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_rubric_config_id_fkey') then
    alter table public.tasks add constraint tasks_rubric_config_id_fkey
      foreign key (rubric_config_id) references public.task_rubric_config(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_sandbox_config_id_fkey') then
    alter table public.tasks add constraint tasks_sandbox_config_id_fkey
      foreign key (sandbox_config_id) references public.task_sandbox_config(id) on delete set null;
  end if;

  -- No ON DELETE here, deliberately: this one matches Supabase, where a
  -- submission's rubric must not quietly become null after the fact. It is the
  -- record of how that submission was actually graded.
  if not exists (select 1 from pg_constraint where conname = 'task_submissions_rubric_config_id_fkey') then
    alter table public.task_submissions add constraint task_submissions_rubric_config_id_fkey
      foreign key (rubric_config_id) references public.task_rubric_config(id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. the values `origin` is allowed to take
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_rubric_config_origin_check') then
    alter table public.task_rubric_config add constraint task_rubric_config_origin_check
      check (origin = any (array['manual'::text, 'auto'::text, 'auto_fallback'::text]));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'task_sandbox_config_origin_check') then
    alter table public.task_sandbox_config add constraint task_sandbox_config_origin_check
      check (origin = any (array['manual'::text, 'auto'::text, 'auto_fallback'::text]));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. make writing to the admin_users view do something
-- ---------------------------------------------------------------------------

-- A view is not writable on its own. These INSTEAD OF triggers are what turn an
-- edit on the view into a change in the underlying tables, and they were left
-- behind when the view was recreated earlier today.
drop trigger if exists admin_users_insert on public.admin_users;
create trigger admin_users_insert
  instead of insert on public.admin_users
  for each row execute function public.admin_users_write();

drop trigger if exists admin_users_update on public.admin_users;
create trigger admin_users_update
  instead of update on public.admin_users
  for each row execute function public.admin_users_write();

grant insert, update, delete, truncate, references, trigger
  on public.admin_users to service_role;

-- ---------------------------------------------------------------------------
-- 4. prove there is nothing left
-- ---------------------------------------------------------------------------

do $$
declare
  missing text;
begin
  select string_agg(want, ', ')
    into missing
    from (values
      ('lot_templates_rubric_config_id_fkey'), ('lot_templates_sandbox_config_id_fkey'),
      ('tasks_rubric_config_id_fkey'), ('tasks_sandbox_config_id_fkey'),
      ('task_submissions_rubric_config_id_fkey'),
      ('task_rubric_config_origin_check'), ('task_sandbox_config_origin_check')
    ) as v(want)
   where not exists (select 1 from pg_constraint where conname = v.want);

  if missing is not null then
    raise exception 'these constraints were not created: %', missing;
  end if;

  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname = 'admin_users' and not t.tgisinternal) <> 2 then
    raise exception 'admin_users does not have both of its write triggers';
  end if;

  if not has_table_privilege('service_role', 'public.admin_users', 'UPDATE') then
    raise exception 'service_role still cannot write admin_users, so the triggers can never fire';
  end if;

  raise notice 'foreign keys, check rules, view triggers and grants all present';
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 5. the index that enforces "only one generic fallback rubric"
--
-- A unique index over a WHERE clause, so it is a rule rather than a lookup: at
-- most one row may be the generic fallback. Without it two could exist, and the
-- code that picks "the" fallback would get whichever the database felt like.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX task_rubric_config_one_generic_fallback ON public.task_rubric_config USING btree (is_generic_fallback) WHERE is_generic_fallback;
