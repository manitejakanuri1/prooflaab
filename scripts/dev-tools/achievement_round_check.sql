-- MF-030 check (TEST only, 30 Oct 2026): every "Match won" line in a student's Achievements names its round
-- and stage, and is a match the Matches tab shows as Won with the same score. Read only; ROLLS BACK.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/achievement_round_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (squad text, line text, matches_tab text, same boolean);
do $$
declare s record; a record; m record;
begin
  -- one member per squad that has a played match (the test squads are archived, so the member is put back in
  -- that squad only for this transaction), signed in as that member
  for s in select distinct on (q.id) q.id, q.name, sm.student_id
             from public.squads q join public.squad_members sm on sm.squad_id = q.id
            where exists (select 1 from public.squad_matches x where x.status = 'played' and q.id in (x.home_squad, x.away_squad))
            order by q.id, sm.left_at desc nulls first
  loop
    perform set_config('app.system_write', 'on', true);
    update public.squad_members set left_at = now() where student_id = s.student_id and left_at is null;
    update public.squad_members set left_at = null
     where ctid = (select ctid from public.squad_members where student_id = s.student_id and squad_id = s.id limit 1);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', s.student_id)::text, true);
    for a in select * from public.my_squad_achievements() where kind = 'win' loop
      -- the Matches tab rule: our points > their points, shown "Won us-them"
      select x.round_number, x.stage,
             case when x.home_squad = s.id then x.home_points else x.away_points end as us,
             case when x.home_squad = s.id then x.away_points else x.home_points end as them
        into m
        from public.squad_matches x
       where x.status = 'played' and s.id in (x.home_squad, x.away_squad)
         and a.detail like 'Round ' || x.round_number || ' · %';
      insert into r values (s.name, a.detail, 'Round ' || m.round_number || ' ' || m.stage || ' Won ' || m.us || '-' || m.them,
                            m.us > m.them and a.detail like '%' || initcap(m.stage) || ' · Beat % ' || m.us || '-' || m.them);
    end loop;
  end loop;
end $$;
select * from r order by squad;
select count(*) as wins_checked, count(*) filter (where not same) as mismatches from r;
rollback;
