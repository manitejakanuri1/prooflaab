-- 167 (MF-011, owner 30 Oct 2026): a squad plays inside one section.
-- assign_to_squad (College > Squads > Assign) accepted a CSE-A student into a CSE-B squad. Forming, rebalance and
-- swaps already match sections; this trigger guards every path that adds or moves a member, with one clear error.
-- Section key = the one form_squads / tpo_rebalance_squads / tpo_reserves use:
--   student: cohort, else branch, else 'GENERAL';  squad: cohort, else 'GENERAL'  (e.g. "CSE-A", see MF-120).
-- Leaving a squad (left_at) is not checked. Rollback: migration/167-rollback-squad-same-section.sql
begin;

create or replace function public.squad_section_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare squad_sec text; student_sec text;
begin
  select coalesce(q.cohort, 'GENERAL') into squad_sec from public.squads q where q.id = new.squad_id;
  select coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') into student_sec
    from public.student_profiles p where p.id = new.student_id;
  if squad_sec is distinct from student_sec then
    raise exception 'A squad plays inside one section: this student is in %, the squad is %.', student_sec, squad_sec
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;
revoke all on function public.squad_section_guard() from public, anon, authenticated;

drop trigger if exists squad_members_same_section on public.squad_members;
create trigger squad_members_same_section
  before insert or update of squad_id, student_id on public.squad_members
  for each row when (new.left_at is null)
  execute function public.squad_section_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'squad_members_same_section'
                  and tgrelid = 'public.squad_members'::regclass) then
    raise exception '167: section trigger missing';
  end if;
end $$;

commit;
