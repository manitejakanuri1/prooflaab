-- ============================================================================
-- Stage 38 — closing the last real gaps in the 21-step journey:
--
--   #16  Weekly progress report   -> a notification each Sunday night, built
--                                    from the same rows the season report reads.
--   #19  Job recommendations      -> a sponsored lot already carries a real
--                                    company's name; my_todays_lot never said
--                                    whose it was. Now it does.
--   #20  Placement tracking       -> tpo_placement_report(), college-scoped,
--                                    same shape as tpo_college_report().
--   #21  Career growth after      -> my_placement_status(), so a hired student
--        placement                  sees it on their own profile.
--
-- Nothing here changes who can see what. It surfaces data that already exists.
-- ============================================================================

-- ── #19: whose lot is this ──────────────────────────────────────────────────
-- Return type is changing, so the old function has to go first.
drop function if exists public.my_todays_lot();

create function public.my_todays_lot()
returns table(
  id uuid, lot_number integer, title text, description text, code_sample text,
  source_jd text, difficulty text, estimate_minutes integer, lot_category text,
  status text, due_date timestamptz, sponsored_by_company text
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date,
         r.company
  from public.tasks t
  left join public.recruiters r on r.id = t.sponsored_by
  where t.student_id = auth.uid() and t.lot_date = current_date
  limit 1;
$$;

grant execute on function public.my_todays_lot() to authenticated;

-- ── #16: the report a student didn't have to go looking for ────────────────
-- Runs a quarter past the weekly squad scoring job, off the rows it just wrote.
-- Silent for a student who scored nothing that week — a zero is not news.
create or replace function public.notify_weekly_progress()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n integer;
begin
  insert into public.notifications (user_id, audience, source, type, title, message, link)
  select w.student_id, 'student', 'system', 'weekly_progress',
         case when prev.points is null or w.points >= prev.points
              then 'Your week: ' || w.points || ' points'
              else 'Your week: ' || w.points || ' points (down from ' || prev.points || ')' end,
         'Week ' || w.week || ': ' || w.points || ' points' ||
           case when prev.points is not null
                then ', ' || (case when w.points >= prev.points then '+' else '' end)
                     || (w.points - prev.points) || ' vs last week'
                else '' end ||
           '. Open your season report for where it came from.',
         '/student/dashboard'
    from public.student_weekly_scores w
    left join public.student_weekly_scores prev
      on prev.student_id = w.student_id and prev.season_id = w.season_id and prev.week = w.week - 1
   where w.week = (select max(w2.week) from public.student_weekly_scores w2 where w2.season_id = w.season_id)
     and w.computed_at >= now() - interval '2 hours'
     and w.points > 0;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.notify_weekly_progress() to service_role;

select cron.schedule(
  'prooflab-weekly-progress-notify', '15 18 * * 0',
  $$ select public.notify_weekly_progress(); $$
);

-- ── #20: placement tracking, college-scoped ─────────────────────────────────
create or replace function public.tpo_placement_report()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  cid uuid := coalesce(public.my_college_id(), public.viewer_college_id());
  pipeline jsonb; hires jsonb; by_company jsonb;
begin
  if cid is null then
    return jsonb_build_object('error', 'Only a college can read this report.');
  end if;

  select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) into pipeline
    from (select sl.stage, count(*) as n
            from public.recruiter_shortlists sl
            join public.student_profiles p on p.id = sl.student_id
           where p.college_id = cid
           group by sl.stage) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'student', p.full_name, 'company', r.company,
           'hired_on', sl.responded_at) order by sl.responded_at desc nulls last),
         '[]'::jsonb)
    into hires
    from public.recruiter_shortlists sl
    join public.student_profiles p on p.id = sl.student_id
    join public.recruiters r on r.id = sl.recruiter_id
   where p.college_id = cid and sl.stage = 'hired';

  select coalesce(jsonb_agg(jsonb_build_object('company', c.company, 'hires', c.n)
                   order by c.n desc), '[]'::jsonb)
    into by_company
    from (select r.company, count(*) as n
            from public.recruiter_shortlists sl
            join public.student_profiles p on p.id = sl.student_id
            join public.recruiters r on r.id = sl.recruiter_id
           where p.college_id = cid and sl.stage = 'hired'
           group by r.company) c;

  return jsonb_build_object(
    'pipeline', pipeline,
    'hired_total', (select count(*) from public.recruiter_shortlists sl
                     join public.student_profiles p on p.id = sl.student_id
                    where p.college_id = cid and sl.stage = 'hired'),
    'hires', hires,
    'by_company', by_company
  );
end $$;

grant execute on function public.tpo_placement_report() to authenticated;

-- ── #21: a student finds out they made it, from their own side ─────────────
create or replace function public.my_placement_status()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when sl.id is null then jsonb_build_object('placed', false)
         else jsonb_build_object('placed', true, 'company', r.company,
                                  'since', sl.responded_at)
         end
    from (select 1) one
    left join lateral (
      select sl.id, sl.responded_at, sl.recruiter_id
        from public.recruiter_shortlists sl
       where sl.student_id = auth.uid() and sl.stage = 'hired'
       order by sl.responded_at desc nulls last limit 1
    ) sl on true
    left join public.recruiters r on r.id = sl.recruiter_id;
$$;

grant execute on function public.my_placement_status() to authenticated;
