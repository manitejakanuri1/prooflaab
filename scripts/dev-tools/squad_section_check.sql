-- MF-011 check (TEST only, 30 Oct 2026): a squad plays inside one section.
--   same-section assign works; cross-section assign is refused by assign_to_squad AND by a direct insert
--   (the squad_members trigger covers every path); leaving a squad still works.
-- Everything happens inside one transaction and ROLLS BACK: nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/squad_section_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (k text, v text);
-- Two PRAGATI Season 1 squads, one per section, open again inside this transaction.
create temp table sq as
select (select id from public.squads where season_id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8' and name = 'CSE-A Titans 1') as a,
       (select id from public.squads where season_id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8' and name = 'CSE-B Titans 1') as b;
update public.squads set archived_at = null, is_locked = false where id in ((select a from sq), (select b from sq));
-- Two CSE-A students of that college, out of any squad for now.
create temp table who as
select (array_agg(p.id order by p.id))[1] as x, (array_agg(p.id order by p.id))[2] as y
  from public.student_profiles p
 where p.college_id = (select college_id from public.squads where id = (select a from sq))
   and coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') = 'CSE-A';
update public.squad_members set left_at = now() where student_id in ((select x from who), (select y from who)) and left_at is null;
-- Signed in as the TEST admin (assign_to_squad checks the caller).
select set_config('request.jwt.claims', json_build_object('role', 'authenticated',
       'sub', (select id from auth.users where email = 'e2e.admin@staging.prooflab.invalid'))::text, true);

-- 1. CSE-A student into a CSE-B squad through Assign: refused.
do $$ begin
  perform public.assign_to_squad((select x from who), (select b from sq));
  insert into r values ('1. Assign CSE-A student to CSE-B squad (want refused)', 'ALLOWED');
exception when others then
  insert into r values ('1. Assign CSE-A student to CSE-B squad (want refused)', 'refused: ' || sqlerrm);
end $$;
-- 2. Same student into a CSE-A squad: works.
insert into r select '2. Assign CSE-A student to CSE-A squad (want true)',
       (public.assign_to_squad((select x from who), (select a from sq)) ->> 'ok');
-- 3. Any other path (a direct insert, as a job or swap would do): refused too.
do $$ begin
  insert into public.squad_members (squad_id, student_id, joined_at) values ((select b from sq), (select y from who), now());
  insert into r values ('3. Direct insert CSE-A student into CSE-B squad (want refused)', 'ALLOWED');
exception when others then
  insert into r values ('3. Direct insert CSE-A student into CSE-B squad (want refused)', 'refused: ' || sqlerrm);
end $$;
-- 4. Leaving a squad still works.
update public.squad_members set left_at = now() where student_id = (select x from who) and left_at is null;
insert into r select '4. Leaving a squad still works (want 0 live rows)',
       count(*)::text from public.squad_members where student_id = (select x from who) and left_at is null;
-- 5. No live member sits in another section's squad.
insert into r select '5. Live members in another section''s squad (want 0)', count(*)::text
  from public.squad_members m join public.squads q on q.id = m.squad_id join public.student_profiles p on p.id = m.student_id
 where m.left_at is null
   and coalesce(q.cohort, 'GENERAL') <> coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL');

select k as check, v as value from r order by k;
rollback;
