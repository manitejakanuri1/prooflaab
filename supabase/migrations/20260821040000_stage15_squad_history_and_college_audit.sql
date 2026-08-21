-- Two things the first end-to-end run of assign_to_squad exposed, both found by
-- moving a real student between two real squads rather than by reading the code.

-- 1. An older unique index enforced one squad per student FOR ALL TIME, not one
-- at a time. That was correct while membership had no history. Now that a row
-- can be closed with left_at, it makes leaving a squad and joining another
-- impossible — the move failed with a duplicate key error after the old row had
-- already been closed.
--
-- squad_members_one_active_squad, added in this stage, already enforces the rule
-- that actually matters: one OPEN membership per student, any number of closed
-- ones behind it.
drop index if exists public.squad_members_one_squad_per_student;

-- 2. A college could not read its own audit trail. Only admins could, which
-- makes §9.2 useless to the person it was written for — the officer who moved
-- the student has no way to see that the move was recorded.
--
-- Read only. Nobody gains insert, update or delete, administrators included:
-- the log stays evidence rather than a document.
create policy audit_logs_college_read on public.audit_logs for select to authenticated
  using (college_id = (select public.my_college_id()));
