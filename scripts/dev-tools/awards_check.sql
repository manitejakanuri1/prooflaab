-- MF-010 check (TEST only): no award and no leaderboard place for a student with 0 season points,
-- and no tie broken by name. Read-only (inside a transaction that rolls back).
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/awards_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (k text, v bigint);
create temp table seasons_seen as select s.id, s.college_id from public.seasons s
 where exists (select 1 from public.student_weekly_scores w where w.season_id = s.id);
create temp table total as select w.season_id, w.student_id, sum(w.points) as pts
  from public.student_weekly_scores w group by 1, 2;
create temp table aw (season_id uuid, award text, student_id uuid, value numeric);
create temp table lb (season_id uuid, kind text, student_id uuid, value numeric);
do $$
declare s record; k text;
begin
  for s in select * from seasons_seen loop
    perform set_config('request.jwt.claims', json_build_object('sub', (select c.user_id from public.colleges c where c.id = s.college_id), 'role', 'authenticated')::text, true);
    insert into aw select s.id, a.award, a.student_id, a.value from public.season_awards(s.id) a;
    foreach k in array array['overall','weekly','growth','consistency','participation','skill'] loop
      insert into lb select s.id, k, l.student_id, l.value from public.season_leaderboard(k, s.id, 100) l;
    end loop;
  end loop;
end $$;
select a.award, coalesce(t.pts, 0) as season_points, a.value from aw a
  left join total t on t.season_id = a.season_id and t.student_id = a.student_id order by 1;
insert into r select 'awards given to a 0-point student (want 0)', count(*) from aw a
  left join total t on t.season_id = a.season_id and t.student_id = a.student_id where coalesce(t.pts, 0) <= 0;
insert into r select 'leaderboard rows with value 0 (want 0)', count(*) from lb where coalesce(value, 0) <= 0;
insert into r select 'leaderboard rows for a 0-point student (want 0)', count(*) from lb l
  left join total t on t.season_id = l.season_id and t.student_id = l.student_id where coalesce(t.pts, 0) <= 0;
select k as check, v as value from r;
rollback;
