-- One season per year group (TEST only, migration 184). ROLLS BACK - nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/season_year_group_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (n int, what text, ok boolean);
grant all on r to public;
do $$
declare
  col uuid; sk uuid; sl uuid; sx uuid; s27 uuid; s28 uuid; s27b uuid; s27c uuid;
  k int; i int; q uuid; ids uuid[]; n int; res jsonb; stu uuid[]; one uuid; ok boolean;
begin
  perform set_config('app.system_write', 'on', true);
  select id into col from public.colleges where name = 'PRAGATI';
  update public.seasons set is_current = false, status = 'complete', completed_at = now() - interval '30 days'
   where college_id = col and is_current;
  update public.squad_members m set left_at = now() from public.student_profiles p
   where p.id = m.student_id and p.college_id = col and m.left_at is null;

  -- 1-7 squads in a section: semi-finals and finals (a season in week 11, sections S1..S7 with k squads)
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current, planned_weeks, year_group, plan_version, created_at)
  values ('chk K', current_date, current_date + 84, col, 'active', true, 12, 2099, 2, now() - interval '105 minutes') returning id into sk;
  for k in 1..7 loop
    for i in 1..k loop
      insert into public.squads (name, college_id, season_id, cohort, max_members, points)
      values ('S' || k || '-' || i, col, sk, 'S' || k, 12, 100 - i * 10) returning id into q;
    end loop;
    if k >= 2 then  -- one league match played in each section (no champion without a league)
      insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort, home_points, away_points)
      select sk, 1, (select id from public.squads where season_id = sk and name = 'S' || k || '-1'),
             (select id from public.squads where season_id = sk and name = 'S' || k || '-2'), now() - interval '100 minutes', 'played', 'league', 'S' || k, 5, 3;
    end if;
  end loop;
  insert into r values (1, 'Week 11 is the semi-finals, week 12 the final, weeks 1-10 the league',
    public.season_phase(sk, 11) = 'knockout' and public.season_phase(sk, 12) = 'final'
    and (select count(*) from public.season_plan(sk) where phase = 'league') = 10);
  perform public.advance_season(sk);
  insert into r values (2, '1 squad: no semi-final; 2 squads: no semi-final',
    not exists (select 1 from public.squad_matches where season_id = sk and stage = 'knockout' and cohort in ('S1', 'S2')));
  insert into r values (3, '3 squads: one semi-final, seed 2 v seed 3',
    (select count(*) from public.squad_matches m where m.season_id = sk and m.stage = 'knockout' and m.cohort = 'S3') = 1
    and exists (select 1 from public.squad_matches m join public.squads h on h.id = m.home_squad join public.squads a on a.id = m.away_squad
                 where m.season_id = sk and m.stage = 'knockout' and m.cohort = 'S3' and h.seed = 2 and a.seed = 3));
  ok := true;
  for k in 4..7 loop
    ok := ok and (select count(*) from public.squad_matches m join public.squads h on h.id = m.home_squad join public.squads a on a.id = m.away_squad
                   where m.season_id = sk and m.stage = 'knockout' and m.cohort = 'S' || k
                     and ((h.seed = 1 and a.seed = 4) or (h.seed = 2 and a.seed = 3))) = 2
              and (select count(*) from public.squads where season_id = sk and cohort = 'S' || k and seed is not null) = 4;
  end loop;
  insert into r values (4, '4, 5, 6, 7 squads: semis 1 v 4 and 2 v 3, only the top 4 go through', ok);
  -- semis: the home side wins
  update public.squad_matches set status = 'played', home_points = 10, away_points = 5
   where season_id = sk and stage = 'knockout';
  update public.seasons set created_at = now() - interval '115 minutes' where id = sk;
  perform public.advance_season(sk);
  insert into r values (5, 'One final in every section with 2 or more squads, none for 1 squad',
    (select count(*) from public.squad_matches where season_id = sk and stage = 'final') = 6
    and not exists (select 1 from public.squad_matches where season_id = sk and stage = 'final' and cohort = 'S1'));
  insert into r values (6, '3 squads: the final is seed 1 v the semi-final winner (seed 2)',
    exists (select 1 from public.squad_matches m join public.squads h on h.id = m.home_squad join public.squads a on a.id = m.away_squad
             where m.season_id = sk and m.stage = 'final' and m.cohort = 'S3' and h.seed = 1 and a.seed = 2));
  -- finals: the away side wins S5 (seed 2), the home side everywhere else
  update public.squad_matches set status = 'played', home_points = case when cohort = 'S5' then 1 else 9 end,
                                  away_points = case when cohort = 'S5' then 8 else 2 end
   where season_id = sk and stage = 'final';
  res := public.close_season(sk);
  insert into r values (7, 'Close: a champion for each of the 6 sections with a final',
    (select count(*) from public.season_champions where season_id = sk) = 6
    and (select q2.name from public.season_champions c join public.squads q2 on q2.id = c.champion_squad_id
          where c.season_id = sk and c.bracket = 'S5') = 'S5-2'
    and (select q2.name from public.season_champions c join public.squads q2 on q2.id = c.champion_squad_id
          where c.season_id = sk and c.bracket = 'S7') = 'S7-1');
  insert into r values (8, 'Third place = the better-seeded semi-final loser (S7: seed 3)',
    (select q2.seed from public.season_champions c join public.squads q2 on q2.id = c.third_squad_id
      where c.season_id = sk and c.bracket = 'S7') = 3);

  -- odd number of squads: one squad rests each week
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current, planned_weeks, year_group, plan_version)
  values ('chk L', current_date, current_date + 84, col, 'active', true, 12, 2098, 2) returning id into sl;
  for i in 1..5 loop
    insert into public.squads (name, college_id, season_id, cohort, max_members) values ('L-' || i, col, sl, 'L', 12);
  end loop;
  perform public.advance_season(sl);
  insert into r values (9, '5 squads: 2 matches every league week (one rests), weeks 1-10',
    (select count(distinct round_number) from public.squad_matches where season_id = sl and stage = 'league') = 10
    and not exists (select 1 from public.squad_matches where season_id = sl and stage = 'league'
                     group by round_number having count(*) <> 2));

  -- pooled sections: X1 (3 squads) + X2 (3 squads), the best 4 of the pool play one semi-final round
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current, planned_weeks, year_group, plan_version, created_at, cross_sections)
  values ('chk X', current_date, current_date + 84, col, 'active', true, 12, 2097, 2, now() - interval '105 minutes', array['X1','X2']) returning id into sx;
  for i in 1..3 loop
    insert into public.squads (name, college_id, season_id, cohort, max_members, points) values ('X1-' || i, col, sx, 'X1', 12, 60 - i * 10);
    insert into public.squads (name, college_id, season_id, cohort, max_members, points) values ('X2-' || i, col, sx, 'X2', 12, 55 - i * 10);
  end loop;
  perform public.advance_season(sx);
  insert into r values (10, 'Pooled sections: one bracket, top 4 by points (X1-1, X2-1, X1-2, X2-2), 2 semi-finals',
    (select count(distinct bracket) from public.squads where season_id = sx) = 1
    and (select array_agg(name order by seed) from public.squads where season_id = sx and seed is not null) = array['X1-1','X2-1','X1-2','X2-2']
    and (select count(*) from public.squad_matches where season_id = sx and stage = 'knockout') = 2);

  -- parallel year groups: 11 CSE-A students move to 2028
  update public.seasons set is_current = false, status = 'complete', completed_at = now() - interval '30 days'
   where id in (sl, sx);
  select array_agg(id order by id) into stu from (select id from public.student_profiles
     where college_id = col and cohort = 'CSE-A' and onboarding_status <> 'blocked' order by id limit 11) x;
  update public.student_profiles set passing_out_year = 2028 where id = any(stu);
  res := public.form_squads(col);
  select id into s27 from public.seasons where college_id = col and is_current and year_group = 2027;
  select id into s28 from public.seasons where college_id = col and is_current and year_group = 2028;
  insert into r values (11, 'Two year groups run their own seasons side by side (2027 and 2028)',
    s27 is not null and s28 is not null and s27 <> s28);
  insert into r values (12, 'The 2028 season has one squad, only 2028 students in it',
    (select count(*) from public.squads where season_id = s28) = 1
    and not exists (select 1 from public.squad_members m join public.squads q2 on q2.id = m.squad_id
                     join public.student_profiles p on p.id = m.student_id
                    where q2.season_id = s28 and p.passing_out_year <> 2028)
    and (select count(*) from public.squad_members m join public.squads q2 on q2.id = m.squad_id where q2.season_id = s28) = 11);
  insert into r values (13, 'New seasons use the new shape (plan 2) and both have league fixtures ready where 2+ squads share a section',
    (select plan_version from public.seasons where id = s27) = 2
    and exists (select 1 from public.squad_matches where season_id = s27 and stage = 'league'));

  -- squads form on any day: the 2027 season is in week 5
  update public.seasons set created_at = now() - interval '45 minutes' where id = s27;
  select m.student_id into one from public.squad_members m join public.squads q2 on q2.id = m.squad_id
   where q2.season_id = s27 limit 1;
  update public.squad_members set left_at = now() - interval '1 minute' where student_id = one and left_at is null;
  res := public.form_squads(col);
  insert into r values (14, 'Week 5: a late student takes a free seat in their own section',
    exists (select 1 from public.squad_members m join public.squads q2 on q2.id = m.squad_id
             where m.student_id = one and m.left_at is null and q2.season_id = s27));
  -- a late section: 22 students of CSE-B become CSE-Z
  select array_agg(id) into stu from (select id from public.student_profiles
     where college_id = col and cohort = 'CSE-B' and passing_out_year = 2027 and onboarding_status <> 'blocked' order by id limit 22) x;
  update public.squad_members set left_at = now() - interval '1 minute' where student_id = any(stu) and left_at is null;
  update public.student_profiles set cohort = 'CSE-Z' where id = any(stu);
  res := public.form_squads(col);
  insert into r values (15, 'Week 5: a late section (22 students) gets 2 squads in the running season',
    (select count(*) from public.squads where season_id = s27 and cohort = 'CSE-Z' and archived_at is null) = 2);
  insert into r values (16, 'The late section plays the league weeks left (5-10), nothing before',
    (select min(round_number) from public.squad_matches m join public.squads q2 on q2.id = m.home_squad
      where m.season_id = s27 and m.stage = 'league' and q2.cohort = 'CSE-Z') = 5
    and (select max(round_number) from public.squad_matches m join public.squads q2 on q2.id = m.home_squad
          where m.season_id = s27 and m.stage = 'league' and q2.cohort = 'CSE-Z') = 10);

  -- back to back: the 2027 season ends, 3 days off (5 minutes in the fast test season), then the next
  update public.squads set points = 40 where season_id = s27;
  perform public.close_season(s27);
  res := public.form_squads(col);
  insert into r values (17, 'Days off: no new season yet, everyone waits',
    not exists (select 1 from public.seasons where college_id = col and is_current and year_group = 2027)
    and (res->>'between_seasons')::int > 0 and res->>'next_season_at' is not null);
  insert into r values (18, 'Days off: no Daily Lot (reason "between seasons"), the 2028 group is not affected',
    -- a Monday with no Lot yet, so the rest-day rule and an existing Lot do not answer first
    (public.create_lot_for(one, date_trunc('week', current_date + 7)::date)->>'reason') = 'between seasons'
    and public.in_season_gap(stu[1]) is not null
    and public.in_season_gap((select m.student_id from public.squad_members m join public.squads q2 on q2.id = m.squad_id
                               where q2.season_id = s28 and m.left_at is null limit 1)) is null);
  -- one test transaction has one clock: move the end (and the moment members left) 6 minutes back
  update public.squad_members m set left_at = left_at - interval '6 minutes' from public.squads q2
   where q2.id = m.squad_id and q2.season_id = s27 and m.left_at = (select completed_at from public.seasons where id = s27);
  update public.seasons set completed_at = completed_at - interval '6 minutes' where id = s27;
  res := public.form_squads(col);
  select id into s27b from public.seasons where college_id = col and is_current and year_group = 2027;
  insert into r values (19, 'After the days off: the next season opens with the same squads (those with members at the end), points from 0',
    s27b is not null
    and (select array_agg(name order by name) from public.squads where season_id = s27b)
        = (select array_agg(q2.name order by q2.name) from public.squads q2 where q2.season_id = s27
            and exists (select 1 from public.squad_members m where m.squad_id = q2.id
                         and m.left_at = (select completed_at from public.seasons where id = s27)))
    and not exists (select 1 from public.squads where season_id = s27b and coalesce(points, 0) <> 0));

  -- "Make fresh squads": the season after this one starts with no carried squads
  update public.seasons set fresh_squads_next = true where id = s27b;
  perform public.close_season(s27b);
  -- later than the season before it (one test transaction has one clock), but past the 5 days-off minutes
  update public.seasons set completed_at = completed_at - interval '330 seconds' where id = s27b;
  s27c := public.ensure_season(col, 2027);
  insert into r values (20, 'Fresh squads: nothing is carried into the next season',
    not exists (select 1 from public.squads where season_id = s27c));
  res := public.form_squads(col);
  insert into r values (21, '... and the waiting students are dealt into new squads at once',
    (select count(*) from public.squads where season_id = s27c) > 0);
end $$;

-- As the college: year-group picker and the season it sees
do $$
declare col uuid; uid uuid; a jsonb; b jsonb;
begin
  select id, user_id into col, uid from public.colleges where name = 'PRAGATI';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform public.tpo_pick_year_group(2028);
  a := public.my_season_status();
  perform public.tpo_pick_year_group(2027);
  b := public.my_season_status();
  insert into r values (22, 'College picks 2028 then 2027: the season bar follows its choice',
    (a->>'year_group')::int = 2028 and (b->>'year_group')::int = 2027 and a->>'season_id' <> b->>'season_id');
  insert into r values (23, 'Year-group list shows both groups with their seasons',
    (select count(*) from jsonb_array_elements(public.tpo_year_groups()) g
      where (g->>'year_group')::int in (2027, 2028) and g->'season' <> 'null'::jsonb) = 2);
end $$;
select n, what, case when ok then 'PASS' else 'FAIL' end as result from r order by n;
select count(*) filter (where ok) || ' of ' || count(*) || ' pass' as total from r;
rollback;
