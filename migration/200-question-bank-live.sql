-- 200 (owner 31 Oct 2026, Part A): the question bank becomes real Daily Lots.
--   1. Questions go live straight away: question_bank.status defaults to 'approved' (an admin can still hide one).
--      Drafts waiting today are made live.
--   2. Each live bank question gets its own small page in source_content (bank_question_id set,
--      url 'bank-question:<id>'), built from the question, its notes and the start of the page it came from.
--      The existing pipeline then does the rest unchanged: pregenerate-lots writes and checks the Lot once,
--      sync_lot_candidate tags its skills, and the picker can hand it to any student. Hiding the question
--      hides its page; deleting the source page deletes both. Students never see any source.
--   3. next_lot_pick: the whole first week (7 days from the student's first Daily Lot) comes from resume skills;
--      from week 2 the performance rules prefer bank Lots, then page Lots, then the old fallbacks.
--   4. Admin material: admin_add_material(title, text, purpose). purpose 'lot' stores it as source pages
--      (long text cut into parts of up to 10,000 characters) that become bank questions; purpose 'roadmap'
--      stores it in roadmap_material, which the roadmap writer reads for matching skills.
--   5. question_bank_pending skips bank pages; admin_content_library does not list them.
-- Rollback: migration/200-rollback-question-bank-live.sql
begin;

alter table public.source_content
  add column if not exists bank_question_id uuid unique references public.question_bank(id) on delete cascade;

alter table public.question_bank alter column status set default 'approved';
update public.question_bank set status = 'approved', reviewed_at = coalesce(reviewed_at, now()) where status = 'draft';

insert into public.source_registry (domain, name, seed_urls, path_scope, rights_flag, license_note)
values ('admin-submitted', 'Material added by a ProofLab admin', '{}', '{}', 'ORIGINAL_ONLY', 'Pasted or uploaded by an admin')
on conflict (domain) do nothing;

-- One live bank question -> one page the Lot writer grounds on.
create or replace function public.bank_question_page(_qid uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare q record; p record; body text; pid uuid;
begin
  select * into q from public.question_bank where id = _qid;
  if q is null then return null; end if;
  select id into pid from public.source_content where bank_question_id = _qid;
  if pid is not null then
    update public.source_content
       set hidden_at = case when q.status = 'approved' then null else coalesce(hidden_at, now()) end
     where id = pid;
    return pid;
  end if;
  if q.status <> 'approved' then return null; end if;
  select * into p from public.source_content where id = q.source_content_id;
  body := 'Question: ' || q.question
       || case when q.answer_notes is not null then E'\n\nWhat a good answer covers: ' || q.answer_notes else '' end
       || case when q.topic is not null then E'\n\nTopic: ' || q.topic else '' end
       || E'\n\nBackground (from the source material):\n' || left(coalesce(p.markdown, ''), 3000);
  insert into public.source_content
    (source_id, url, title, markdown, content_hash, fetch_method, rights_flag, submitted_by_college_id,
     grading_mode_hint, visibility, bank_question_id)
  values
    (p.source_id, 'bank-question:' || q.id,
     left(coalesce(q.topic, q.skill, left(q.question, 80)) || ' - ' || coalesce(p.title, 'question'), 200),
     body, encode(sha256(convert_to(body, 'UTF8')), 'hex'), 'manual', p.rights_flag, p.submitted_by_college_id,
     case when q.kind = 'coding' then 'sandbox' else 'rubric' end, p.visibility, q.id)
  on conflict do nothing
  returning id into pid;
  return pid;
end $fn$;
revoke all on function public.bank_question_page(uuid) from public, anon, authenticated;
grant execute on function public.bank_question_page(uuid) to service_role;

create or replace function public.question_bank_to_page()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform public.bank_question_page(new.id);
  return new;
end $fn$;
revoke all on function public.question_bank_to_page() from public, anon, authenticated;
drop trigger if exists question_bank_to_page on public.question_bank;
create trigger question_bank_to_page after insert or update of status on public.question_bank
  for each row execute function public.question_bank_to_page();

-- Questions already live (from step 1) get their pages now.
select public.bank_question_page(id) from public.question_bank where status = 'approved';

-- Bank pages are never cut into questions again. _since: only pages fetched from that time (the crawler passes
-- its own start time, so a crawl writes questions for what it brought in, never the whole old library).
drop function if exists public.question_bank_pending(integer);
create or replace function public.question_bank_pending(_limit integer default 3, _since timestamptz default null)
returns table (id uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select sc.id
    from public.source_content sc
   where sc.hidden_at is null and sc.bank_question_id is null
     and length(coalesce(sc.markdown, '')) >= 300
     and (_since is null or sc.fetched_at >= _since)
     and not exists (select 1 from public.question_bank_attempts a where a.source_content_id = sc.id)
   order by sc.fetched_at desc
   limit greatest(1, least(coalesce(_limit, 3), 10));
$fn$;
revoke all on function public.question_bank_pending(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.question_bank_pending(integer, timestamptz) to service_role;

-- Material for roadmap tasks (purpose 'roadmap'). Read only by the roadmap writer (service role) and admins.
create table if not exists public.roadmap_material (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) between 3 and 200),
  markdown   text not null check (length(markdown) between 80 and 60000),
  skills     text[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  hidden_at  timestamptz
);
alter table public.roadmap_material enable row level security;
revoke all on public.roadmap_material from public, anon, authenticated;
grant select, insert, update, delete on public.roadmap_material to service_role;

create or replace function public.admin_add_material(_title text, _content text, _purpose text default 'lot')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare t text := btrim(coalesce(_title, '')); c text := btrim(coalesce(_content, ''));
        reg uuid; part text; rest text; cut int; n int := 0; ids uuid[] := '{}'; nid uuid;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(_purpose, '') not in ('lot', 'roadmap') then raise exception 'purpose must be lot or roadmap'; end if;
  if length(t) < 3 or length(t) > 200 then raise exception 'Title must be 3-200 characters'; end if;
  if length(c) < 80 then raise exception 'The text must be at least 80 characters'; end if;
  if length(c) > 60000 then raise exception 'The text must be under 60,000 characters'; end if;
  if _purpose = 'roadmap' then
    insert into public.roadmap_material (title, markdown, skills, created_by)
    values (t, c, public.tag_skills(t || ' ' || left(c, 4000)), auth.uid()) returning id into nid;
    return jsonb_build_object('purpose', 'roadmap', 'ids', jsonb_build_array(nid));
  end if;
  select id into reg from public.source_registry where domain = 'admin-submitted';
  rest := c;
  while length(rest) > 0 loop
    if length(rest) <= 10000 then
      part := rest; rest := '';
    else
      cut := 10000 - position(E'\n' in reverse(left(rest, 10000))) + 1;
      if cut < 6000 or cut > 10000 then cut := 10000; end if;
      part := left(rest, cut); rest := btrim(substr(rest, cut + 1));
    end if;
    n := n + 1;
    nid := null;
    insert into public.source_content (source_id, url, title, markdown, content_hash, fetch_method, rights_flag)
    values (reg, 'admin-material:' || gen_random_uuid(),
            case when length(c) > 10000 then left(t, 185) || ' (part ' || n || ')' else t end,
            part, encode(sha256(convert_to(part, 'UTF8')), 'hex'), 'manual', 'ORIGINAL_ONLY')
    on conflict (source_id, content_hash) do nothing
    returning id into nid;
    if nid is not null then ids := ids || nid; end if;
  end loop;
  return jsonb_build_object('purpose', 'lot', 'ids', to_jsonb(ids));
end $fn$;
revoke all on function public.admin_add_material(text, text, text) from public, anon;
grant execute on function public.admin_add_material(text, text, text) to authenticated;

create or replace function public.admin_roadmap_material()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'skills', skills,
            'chars', length(markdown), 'created_at', created_at, 'hidden', hidden_at is not null)
            order by created_at desc)
     from public.roadmap_material), '[]'::jsonb);
end $fn$;
create or replace function public.admin_hide_roadmap_material(_id uuid, _hidden boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.roadmap_material set hidden_at = case when _hidden then now() end where id = _id;
end $fn$;
revoke all on function public.admin_roadmap_material(), public.admin_hide_roadmap_material(uuid, boolean) from public, anon;
grant execute on function public.admin_roadmap_material(), public.admin_hide_roadmap_material(uuid, boolean) to authenticated;

-- The roadmap writer passes the student's weak topics as text; the material whose skills overlap most comes first.
create or replace function public.roadmap_material_for(_text text, _limit integer default 2)
returns table (title text, excerpt text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with want as (select public.tag_skills(coalesce(_text, '')) as sk)
  select m.title, left(m.markdown, 2500)
    from public.roadmap_material m, want
   where m.hidden_at is null and m.skills && want.sk
   order by cardinality(array(select unnest(m.skills) intersect select unnest(want.sk))) desc, m.created_at desc
   limit greatest(1, least(coalesce(_limit, 2), 3));
$fn$;
revoke all on function public.roadmap_material_for(text, integer) from public, anon, authenticated;
grant execute on function public.roadmap_material_for(text, integer) to service_role;

create or replace function public.next_lot_pick(_student_id uuid, _for_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $fn$
declare
  college uuid;
  kind    text := public.lot_day_kind(coalesce(_for_date, current_date));
  mine    text[];
  ev      record;
  ev_json jsonb;
  c_id    uuid;  c_sc uuid;  c_sk text[];  c_diff text;
  rule    text;  why text;   focus text;   drank int;
  ev10    jsonb; ev3 jsonb;
  first_d date;
begin
  select p.college_id into college from public.student_profiles p where p.id = _student_id;
  if kind in ('business', 'pitch', 'saturday') then
    select p.candidate_id, p.source_content_id, p.skills into c_id, c_sc, c_sk
      from public.lot_candidate_pool(_student_id, college) p
      join public.lot_candidates c on c.id = p.candidate_id
      join public.lot_templates t on t.id = c.lot_template_id
     where t.lot_category = any(case when kind = 'saturday' then array['business', 'pitch']
                                 when kind = 'pitch' then array['pitch', 'business'] else array[kind] end)
     order by (t.lot_category = kind) desc, p.own_college desc, md5(_student_id::text || p.candidate_id::text)
     limit 1;
    if c_id is not null then
      return jsonb_build_object('version', 'lot-select-3', 'rule', 'day_' || kind, 'candidate_id', c_id,
               'source_content_id', c_sc, 'focus_skill', c_sk[1], 'evidence', null,
               'why', case kind when 'business' then 'Tuesday is business day.'
                                when 'pitch' then 'Thursday is pitch day.'
                                else 'Saturday is career day.' end);
    end if;
  end if;
  if kind = 'technical' then
    mine := public.lot_student_skills(_student_id);
    select min(t.lot_date) into first_d from public.tasks t
     where t.student_id = _student_id and t.lot_date is not null;
    -- STARTER (200, owner 31 Oct 2026): the whole first week of Daily Lots comes from the student's own resume
    -- skills, Easy or Medium. From week 2 the performance rules below pick, bank questions first.
    if (first_d is null or coalesce(_for_date, current_date) - first_d < 7) and cardinality(mine) > 0 then
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p
        join public.lot_candidates c on c.id = p.candidate_id
        join public.lot_templates t on t.id = c.lot_template_id
       where t.lot_category = 'technical' and p.skills && mine
         and lower(coalesce(p.difficulty, 'easy')) in ('easy', 'medium')
       order by (select count(*) from public.tasks k join public.lot_candidates kc on kc.id = k.lot_candidate_id
                  where k.student_id = _student_id and kc.skills && p.skills) asc,
                lower(coalesce(p.difficulty, 'easy')) = 'easy' desc,
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        focus := (select s from unnest(c_sk) s where s = any(mine) limit 1);
        return jsonb_build_object('version', 'lot-select-3', 'rule', 'starter', 'candidate_id', c_id,
                 'source_content_id', c_sc, 'focus_skill', focus, 'evidence', null,
                 'why', format('Your first week of Lots comes from the skills on your resume. Today: %s.', focus));
      end if;
    end if;
    -- AFTER THE START: the existing performance rules, on technical Lots inside the student's skills.
    ev10 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 10) e);
    mine := coalesce(mine, '{}') || coalesce((select array_agg(e->>'skill') from jsonb_array_elements(ev10) e), '{}');
    for ev in select * from jsonb_to_recordset(coalesce(ev10, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
               where e.avg_score < 70 order by e.avg_score asc, e.last_at desc loop
      drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p
        join public.lot_candidates c on c.id = p.candidate_id
        join public.lot_templates t on t.id = c.lot_template_id
        join public.source_content bs on bs.id = p.source_content_id
       where t.lot_category = 'technical' and ev.skill = any(p.skills)
       order by (bs.bank_question_id is not null) desc, abs(case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end - drank),
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        rule := 'strengthen'; focus := ev.skill; ev_json := to_jsonb(ev);
        why := format('Your last %s %s Lot%s averaged %s/100. Today''s Lot practises %s again.',
                      ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score, ev.skill);
        exit;
      end if;
    end loop;
    if c_id is null and ev10 is not null then
      ev3 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 3) e);
      for ev in select * from jsonb_to_recordset(coalesce(ev3, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
                 where e.avg_score >= 85 order by e.last_at desc limit 1 loop
        drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
        select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
          from public.lot_candidate_pool(_student_id, college) p
          join public.lot_candidates c on c.id = p.candidate_id
          join public.lot_templates t on t.id = c.lot_template_id
          join public.source_content bs on bs.id = p.source_content_id
         where t.lot_category = 'technical' and ev.skill = any(p.skills)
         order by (bs.bank_question_id is not null) desc, (case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end > drank) desc,
                  p.own_college desc, md5(_student_id::text || p.candidate_id::text)
         limit 1;
        if c_id is not null then
          rule := 'step_up'; focus := ev.skill; ev_json := to_jsonb(ev);
          why := format('Your last %s %s Lot%s averaged %s/100. Today''s Lot is a step up.',
                        ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score);
        end if;
      end loop;
    end if;
    -- BROADEN, but only to a skill that is the student's own and not practised recently.
    if c_id is null and cardinality(mine) > 0 then
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p
        join public.lot_candidates c on c.id = p.candidate_id
        join public.lot_templates t on t.id = c.lot_template_id
        join public.source_content bs on bs.id = p.source_content_id
       where t.lot_category = 'technical' and p.skills && mine
       order by (bs.bank_question_id is not null) desc, (p.skills && coalesce((select array_agg(e->>'skill') from jsonb_array_elements(ev10) e), '{}')) asc,
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        rule := 'broaden'; focus := (select s from unnest(c_sk) s where s = any(mine) limit 1);
        why := format('Today''s Lot is on %s, one of your own skills.', focus);
      end if;
    end if;
    if c_id is not null then
      return jsonb_build_object('version', 'lot-select-3', 'rule', rule, 'candidate_id', c_id,
               'source_content_id', c_sc, 'focus_skill', focus, 'why', why, 'evidence', ev_json);
    end if;
  end if;
  -- Nothing fits the day or the student's skills: the old rotation, so no student is left without a Lot.
  c_sc := public.next_lot_source(_student_id);
  if c_sc is null then return null; end if;
  return jsonb_build_object('version', 'lot-select-3', 'rule', 'rotation',
           'candidate_id', (select c.id from public.lot_candidates c where c.source_content_id = c_sc
                             order by (c.status = 'active') desc, c.created_at limit 1),
           'source_content_id', c_sc, 'focus_skill', null, 'evidence', null,
           'why', 'No unused Lot matches today''s plan and your skills yet, so this one comes from the shared pool.');
end $fn$;

-- The content library lists real pages, not the per-question bank pages.
create or replace function public.admin_content_library()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sc.id, 'url', sc.url, 'title', sc.title,
               'site', coalesce(r.name, r.domain), 'domain', r.domain,
               'fetch_method', sc.fetch_method, 'fetched_at', sc.fetched_at,
               'chars', length(coalesce(sc.markdown, '')),
               'college', c.name,
               'lot_written', exists (select 1 from public.lot_templates t where t.source_content_id = sc.id),
               'times_given', (select count(*) from public.tasks k where k.source_content_id = sc.id),
               'hidden', sc.hidden_at is not null)
             order by sc.hidden_at nulls first, sc.fetched_at desc)
        from public.source_content sc
        left join public.source_registry r on r.id = sc.source_id
        left join public.colleges c on c.id = sc.submitted_by_college_id
       where sc.bank_question_id is null), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('site', coalesce(name, domain), 'domain', domain,
                                          'seeds', cardinality(seed_urls), 'rights', rights_flag,
                                          'retired', retired_at is not null) order by domain)
        from public.source_registry), '[]'::jsonb),
    'newest_fetch', (select max(fetched_at) from public.source_content)
  );
end;
$fn$;

do $$ begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'question_bank' and column_name = 'status') not like '%approved%' then
    raise exception '200 self-check: bank questions are not live by default';
  end if;
  if exists (select 1 from public.question_bank q where q.status = 'approved'
              and not exists (select 1 from public.source_content s where s.bank_question_id = q.id)) then
    raise exception '200 self-check: a live bank question has no page';
  end if;
  if has_table_privilege('authenticated', 'public.roadmap_material', 'select') then
    raise exception '200 self-check: students can read roadmap material';
  end if;
  if has_function_privilege('authenticated', 'public.roadmap_material_for(text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.bank_question_page(uuid)', 'execute') then
    raise exception '200 self-check: signed-in users can reach service-only bank functions';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
