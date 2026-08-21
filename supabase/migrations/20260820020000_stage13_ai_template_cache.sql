-- ============================================================================
-- TEMPLATE_KEY caching.
--
-- Checked before building it: most AI calls here are genuinely per student —
-- reading their resume, grading their answers, judging their recording. Those
-- cannot be shared and are not touched.
--
-- Two are different. Coding problems are generated from skills plus target
-- role, and the skip-path quiz from skills plus interests plus target role.
-- Two students with the same profile give identical inputs, so the model is
-- being paid twice for the same answer.
--
-- The saving is nothing at one student and large at ten thousand, which is
-- exactly the shape of a cache worth having and not worth rushing.
-- ============================================================================

create table public.ai_templates (
  template_key  text primary key,
  kind          text not null check (kind in ('coding_round', 'interest_quiz', 'task_seed')),
  role          text,
  paths         text[],
  level_profile text,
  payload       jsonb not null,
  hit_count     integer not null default 0,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create index ai_templates_kind_idx on public.ai_templates (kind, last_used_at desc);

alter table public.ai_templates enable row level security;
-- No policy, on purpose. Only the edge functions touch this, and the payloads
-- contain quiz content.
grant all on public.ai_templates to service_role;
revoke all on public.ai_templates from anon, authenticated;

-- One place that decides what "the same profile" means, so two callers cannot
-- disagree and quietly halve the hit rate. Skills are normalised and sorted:
-- "Node.js, React" and "react, nodejs" must produce the same key.
create or replace function public.template_key(
  _kind text, _role text, _skills text[], _extra text default null)
returns text language sql immutable set search_path = public, pg_temp
as $fn$
  select _kind || '-'
      || coalesce(nullif(lower(regexp_replace(_role, '[^a-zA-Z0-9]+', '_', 'g')), ''), 'any')
      || '-'
      || coalesce(
           (select string_agg(s, '+' order by s)
              from (select distinct lower(regexp_replace(unnest, '[\s._\-]', '', 'g')) as s
                      from unnest(coalesce(_skills, '{}'::text[]))
                     where unnest is not null and unnest <> '') x),
           'none')
      || coalesce('-' || lower(regexp_replace(_extra, '[^a-zA-Z0-9]+', '_', 'g')), '');
$fn$;

revoke all on function public.template_key(text, text, text[], text) from public, anon, authenticated;

-- Counts a reuse, so the hit rate is measurable. Under 50% means the key is too
-- narrow and the cache is not earning its place.
create or replace function public.touch_template(_key text)
returns void language sql security definer set search_path = public, pg_temp
as $fn$
  update public.ai_templates
     set hit_count = hit_count + 1, last_used_at = now()
   where template_key = _key;
$fn$;

revoke all on function public.touch_template(text) from public, anon, authenticated;


-- ── the award engine could not write ────────────────────────────────────
-- Found by running the whole dashboard end to end: quests completed but XP
-- stayed at 0, and no badge was awarded.
--
-- The cause was this line of work's own column guard. record_activity runs
-- from a trigger during the student's own insert, so the token still says
-- 'authenticated' — and protect_columns could not tell "the student is writing
-- their own XP" from "the award engine is writing it on their behalf". It
-- clamped both, which is the safe way to be wrong but wrong nonetheless.
--
-- The fix is an explicit, transaction-local marker that only SECURITY DEFINER
-- system functions set. A browser cannot set it: set_config is not reachable
-- through PostgREST, and the flag is cleared before the function returns.
create or replace function public.protect_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  raw text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text; clamp boolean := true;
  col text; newj jsonb; oldj jsonb;
begin
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;                      -- a system function, on the student's behalf
  end if;
  if raw is null then return new; end if;

  begin
    jwt_role := raw::jsonb ->> 'role';
    if jwt_role is distinct from 'authenticated' then clamp := false;
    elsif public.is_admin() then clamp := false; end if;
  exception when others then clamp := true; end;

  if not clamp then return new; end if;

  newj := to_jsonb(new); oldj := to_jsonb(old);
  foreach col in array tg_argv loop
    newj := jsonb_set(newj, array[col], oldj -> col);
  end loop;
  return jsonb_populate_record(new, newj);
end $fn$;

-- record_activity raises the flag around its own writes and lowers it again,
-- so nothing later in the same transaction inherits it.
create or replace function public.record_activity(_student_id uuid, _metric text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  q record; b record; period date;
  have integer; topics integer; proofs integer; streak integer;
begin
  if _student_id is null then return; end if;
  perform set_config('app.system_write', 'on', true);
  perform public.touch_streak(_student_id);

  for q in select * from public.quests where is_active and metric = _metric loop
    period := case when q.cadence = 'daily' then current_date
                   else date_trunc('week', current_date)::date end;
    insert into public.student_quests (student_id, quest_slug, period_start, progress)
    values (_student_id, q.slug, period, 1)
    on conflict (student_id, quest_slug, period_start) do update
      set progress = least(public.student_quests.progress + 1, q.target);

    update public.student_quests sq set completed_at = now()
     where sq.student_id = _student_id and sq.quest_slug = q.slug
       and sq.period_start = period and sq.progress >= q.target
       and sq.completed_at is null;

    if found then
      insert into public.xp_logs (student_id, xp_points, source)
      values (_student_id, q.xp_reward, 'quest:' || q.slug);
      update public.student_profiles set total_xp = total_xp + q.xp_reward
       where id = _student_id;
    end if;
  end loop;

  select count(*) into topics from public.student_levels
   where student_id = _student_id and status in ('cleared', 'mastered');
  select count(*) into proofs from public.proof_uploads
   where student_id = _student_id and status = 'Verified';
  select coalesce(current_days, 0) into streak from public.student_streaks
   where student_id = _student_id;

  for b in select * from public.badges loop
    have := case b.rule_kind when 'level' then topics when 'proof' then proofs
                             when 'streak' then streak else 0 end;
    if b.rule_value is not null and have >= b.rule_value then
      insert into public.student_badges (student_id, badge_slug)
      values (_student_id, b.slug) on conflict (student_id, badge_slug) do nothing;
    end if;
  end loop;

  perform set_config('app.system_write', 'off', true);
end $fn$;

revoke all on function public.record_activity(uuid, text) from public, anon, authenticated;
