-- READ ONLY. Lists the REAL rows that migration 20261001000300 (stage61 demo fixture) can have written.
-- Nothing is changed. Ids are the ones written in that migration.
with ids as (select '165e89b0-4ff3-425d-8e4b-44f137c01f34'::uuid col, 'b07b9ae3-9121-4780-b31b-cb8ba8fdf9ff'::uuid sea,
                    array['e724043f-cba0-4df6-a4ad-03eb17bf223f','3998c495-64f9-4b13-ad0e-9ddfee97b34d',
                          '9f77c6d5-bd7c-489e-9410-3db888729328']::uuid[] stu,
                    'e724043f-cba0-4df6-a4ad-03eb17bf223f'::uuid yash)
select line from (
  select 1 o, 'COLLEGE: ' || c.id || ' | ' || c.name line from public.colleges c, ids where c.id = ids.col
  union all select 2, 'SEASON: ' || s.id || ' | status=' || s.status || ' | starts ' || s.starts_on from public.seasons s, ids where s.id = ids.sea
  union all select 3, 'STUDENT: ' || p.id || ' | ' || p.full_name || ' | college=' || coalesce(p.college_id::text,'none')
                  || ' | total_xp=' || coalesce(p.total_xp::text,'-')
              from public.student_profiles p, ids where p.id = any(ids.stu)
  union all select 4, 'SQUAD: ' || q.id || ' | ' || q.name || ' | points=' || q.points || ' | W-D-L ' || q.wins || '-' || q.draws || '-' || q.losses
              from public.squads q, ids where q.college_id = ids.col and q.name = 'Kernel Panic'
  union all select 5, 'SQUAD_MEMBER: ' || m.student_id || ' | contribution=' || m.contribution
              from public.squad_members m join public.squads q on q.id = m.squad_id, ids where q.college_id = ids.col and q.name = 'Kernel Panic'
  union all select 6, 'SQUAD_WEEK: week ' || w.week || ' | points=' || w.points || ' | rank=' || w.rank
              from public.squad_weekly_scores w join public.squads q on q.id = w.squad_id, ids where q.college_id = ids.col and q.name = 'Kernel Panic'
  union all select 7, 'STUDENT_WEEK: ' || w.student_id || ' | week ' || w.week || ' | points=' || w.points
              from public.student_weekly_scores w, ids where w.season_id = ids.sea and w.student_id = any(ids.stu)
  -- trust 82 (trust_scores, student_profiles.trust_score) and AI 88/82/91/87 (proof_uploads) were in tables/columns
  -- removed later; this line says whether they still exist instead of failing.
  union all select 8, 'RETIRED: trust_scores table ' || case when to_regclass('public.trust_scores') is null then 'gone' else 'STILL THERE' end
                  || ' · proof_uploads table ' || case when to_regclass('public.proof_uploads') is null then 'gone' else 'STILL THERE' end
  union all select 9, 'TASK: ' || k.id || ' | ' || k.title || ' | source=' || k.source from public.tasks k, ids
              where k.student_id = ids.yash and k.source in ('level_checkpoint','lot')
  union all select 11, 'TOPIC: ' || r.topic || ' | rating=' || r.rating || ' | attempts=' || r.attempts from public.topic_ratings r, ids
              where r.student_id = ids.yash and r.topic in ('HTML/CSS','JavaScript','TypeScript','React')
  union all select 12, 'LEVEL: ' || l.level_id || ' | status=' || l.status from public.student_levels l, ids where l.student_id = ids.yash
  union all select 13, 'TRACK: ' || t.track_slug from public.student_tracks t, ids where t.student_id = ids.yash and t.track_slug = 'web-development'
  union all select 14, 'XP_LOG: ' || x.xp_points || ' | ' || x.source from public.xp_logs x, ids where x.student_id = ids.yash
) z order by o, line;
