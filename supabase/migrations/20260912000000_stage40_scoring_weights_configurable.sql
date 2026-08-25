-- ============================================================================
-- Stage 40 — §27 of the master spec, word for word: "thresholds, scoring
-- weights, season length, squad naming, and notification settings should not
-- be hard-coded where avoidable." squad_scoring_rules was already a table
-- rather than numbers in a function, but nothing could write to it except a
-- migration — a college "weighting explanations over volume" needed code
-- changed on their behalf. This makes it a real per-college setting.
--
-- Design: a row with college_id = null is the platform default (unchanged,
-- six rows, same values as before). A college that overrides a metric gets
-- its own row with its college_id set; only that metric changes for them.
-- Every place that reads the rules now prefers the college-specific row over
-- the default, falling back to the default for anything the college has not
-- touched. A student with no college (the separate-signup door) always gets
-- the platform default, because there is no college to ask.
-- ============================================================================

alter table public.squad_scoring_rules
  add column id uuid not null default gen_random_uuid(),
  add column college_id uuid references public.colleges(id) on delete cascade;

alter table public.squad_scoring_rules drop constraint squad_scoring_rules_pkey;
alter table public.squad_scoring_rules add constraint squad_scoring_rules_pkey primary key (id);

-- Postgres treats two NULLs as different by default, which would let the
-- platform default for a metric be inserted twice. NULLS NOT DISTINCT closes
-- that, and still allows one override row per college per metric.
alter table public.squad_scoring_rules
  add constraint squad_scoring_rules_metric_college_key
  unique nulls not distinct (metric, college_id);

create index squad_scoring_rules_college_idx on public.squad_scoring_rules (college_id);


-- ── the live scoring path reads the effective rule, not just "the" rule ────
-- college_id already lives on every activity event (denormalised there for
-- exactly this kind of lookup), so no join back to student_profiles is needed.
create or replace function public.run_squad_week(_season_id uuid, _week integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk integer := coalesce(_week, greatest(1, public.season_week(_season_id) - 1));
  ranked integer := 0;
  played integer := 0;
begin
  -- individual scores for the week
  insert into public.student_weekly_scores
    (season_id, student_id, squad_id, week, points, breakdown)
  select _season_id, m.student_id, m.squad_id, wk,
         coalesce(sum(r.points), 0),
         coalesce(jsonb_object_agg(r.metric, r.n) filter (where r.metric is not null), '{}'::jsonb)
    from public.squad_members m
    join public.squads q on q.id = m.squad_id and q.season_id = _season_id
    left join lateral (
      select sr.metric, sr.points * count(*) as points, count(*) as n
        from public.student_activity_events e
        join lateral (
          -- college_id already lives on the event row, so this needs no join
          -- back to student_profiles. A college-specific row wins over the
          -- platform default for the same metric.
          select * from public.squad_scoring_rules sr2
           where sr2.metric = e.event_type
             and (sr2.college_id = e.college_id or sr2.college_id is null)
           order by sr2.college_id nulls last
           limit 1
        ) sr on true
       where e.student_id = m.student_id
         and e.occurred_at >= public.season_week_start(_season_id, wk)
         and e.occurred_at <  public.season_week_start(_season_id, wk) + interval '7 days'
       group by sr.metric, sr.points
    ) r on true
   where m.left_at is null
   group by m.student_id, m.squad_id
  on conflict (season_id, student_id, week)
    do update set points = excluded.points, breakdown = excluded.breakdown;

  -- squad totals for the week
  insert into public.squad_weekly_scores
    (season_id, squad_id, week, points, active_members, total_members)
  select _season_id, q.id, wk,
         coalesce((select sum(s.points) from public.student_weekly_scores s
                    where s.season_id = _season_id and s.squad_id = q.id and s.week = wk), 0),
         coalesce((select count(*) from public.student_weekly_scores s
                    where s.season_id = _season_id and s.squad_id = q.id and s.week = wk and s.points > 0), 0),
         coalesce((select count(*) from public.squad_members m
                    where m.squad_id = q.id and m.left_at is null), 0)
    from public.squads q
   where q.season_id = _season_id
  on conflict (season_id, squad_id, week)
    do update set points = excluded.points,
                  active_members = excluded.active_members,
                  total_members = excluded.total_members,
                  computed_at = now();

  with r as (
    select squad_id, rank() over (order by points desc, squad_id) as pos
      from public.squad_weekly_scores
     where season_id = _season_id and week = wk
  )
  update public.squad_weekly_scores w set rank = r.pos
    from r where w.squad_id = r.squad_id and w.season_id = _season_id and w.week = wk;

  -- season points are every week so far, not just this one
  update public.squads q
     set previous_rank = q.rank,
         points = coalesce((select sum(points) from public.squad_weekly_scores
                             where season_id = _season_id and squad_id = q.id), 0)
   where q.season_id = _season_id;

  select count(*) into ranked from public.squads where season_id = _season_id;

  played := public.settle_round(_season_id, wk);
  perform public.recount_season(_season_id);

  perform public.write_audit('SQUAD_WEEK_SCORED', 'squad_weekly_scores', _season_id,
    null, jsonb_build_object('week', wk, 'squads', ranked, 'matches_settled', played),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'week', wk, 'squads_scored', ranked,
                            'matches_settled', played);
end $fn$;

-- score_student_week is unreferenced by any live caller (run_squad_week above
-- stopped calling it back in stage 32) but is left in place and fixed anyway,
-- rather than left as a landmine the next reader assumes is safe to revive.
create or replace function public.score_student_week(
  _student_id uuid, _season_id uuid, _week integer
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  b timestamptz; e timestamptz; cid uuid;
  breakdown jsonb := '{}'::jsonb;
  total integer := 0;
  r record; n integer;
begin
  select starts_at, ends_at into b, e from public.season_week_bounds(_season_id, _week);
  if b is null then return jsonb_build_object('points', 0, 'breakdown', '{}'::jsonb); end if;
  select college_id into cid from public.student_profiles where id = _student_id;

  for r in
    select distinct on (metric) *
      from public.squad_scoring_rules
     where college_id = cid or college_id is null
     order by metric, college_id nulls last
  loop
    if r.metric = 'active_day' then
      select count(distinct occurred_at::date) into n
        from public.student_activity_events
       where student_id = _student_id and occurred_at >= b and occurred_at < e;
    else
      select count(*) into n
        from public.student_activity_events
       where student_id = _student_id and event_type = r.metric
         and occurred_at >= b and occurred_at < e;
    end if;

    if n > 0 then
      breakdown := breakdown || jsonb_build_object(r.metric,
                     jsonb_build_object('count', n, 'points', n * r.points));
      total := total + (n * r.points);
    end if;
  end loop;

  return jsonb_build_object('points', total, 'breakdown', breakdown);
end $fn$;


-- ── what a college sees and can change ──────────────────────────────────
create function public.tpo_scoring_rules()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'metric', d.metric, 'label', d.label, 'description', d.description,
           'default_points', d.points,
           'points', coalesce(o.points, d.points),
           'customized', o.points is not null)
         order by d.metric), '[]'::jsonb)
    from public.squad_scoring_rules d
    left join public.squad_scoring_rules o
      on o.metric = d.metric and o.college_id = public.my_college_id()
   where d.college_id is null;
$$;

grant execute on function public.tpo_scoring_rules() to authenticated;

create function public.tpo_set_scoring_weight(_metric text, _points integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare cid uuid := public.my_college_id(); lbl text; desc_ text;
begin
  if cid is null then raise exception 'Only a college can set this.'; end if;
  if _points < 0 or _points > 1000 then raise exception 'Points must be between 0 and 1000.'; end if;

  select label, description into lbl, desc_
    from public.squad_scoring_rules where metric = _metric and college_id is null;
  if lbl is null then raise exception 'unknown scoring metric %', _metric; end if;

  insert into public.squad_scoring_rules (metric, label, points, description, college_id)
  values (_metric, lbl, _points, desc_, cid)
  on conflict (metric, college_id) do update set points = excluded.points;

  return jsonb_build_object('ok', true, 'metric', _metric, 'points', _points);
end $$;

grant execute on function public.tpo_set_scoring_weight(text, integer) to authenticated;

create function public.tpo_reset_scoring_weight(_metric text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare cid uuid := public.my_college_id();
begin
  if cid is null then raise exception 'Only a college can reset this.'; end if;
  delete from public.squad_scoring_rules where metric = _metric and college_id = cid;
  return jsonb_build_object('ok', true, 'metric', _metric);
end $$;

grant execute on function public.tpo_reset_scoring_weight(text) to authenticated;
