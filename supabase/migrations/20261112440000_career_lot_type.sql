-- 440 (owner 12 Nov 2026): a "Career" Lot type for the bank questions no skill fits.
-- Migration 341 left 119 career / interview / ethics / data-communication questions with no skill (the
-- "general bucket", bank_skill_retag_341 how = 'ai: general ...'). Their Lots were never given to anyone: the
-- technical picker needs one of the student's skills, and their seed cards were 'technical' with no skill.
-- Also moved: the 7 interview-answer questions ("Explain your project", 'Workplace Writing' tag, seed cards whose
-- title still says "{item}").
--   1. lot_category 'career' is allowed on lot_templates and tasks.
--   2. Their seed cards become written Career Lots, NO AI: the title is the question's own topic and the task is the
--      question's own words + "Your task" / "What to write" lines. The checker stays the shared written checker
--      the seed already had (is_generic_fallback): same grader, same prompt, same pass mark. origin 'ai' like the
--      hand-written resume Lots (236) - the only other value is 'seed', which would send them to the writer.
--   3. next_lot_pick: Saturday (already called "career day") gives a Career Lot first, then business, then pitch.
-- Only seed cards are changed (a card someone already wrote is left alone). Old values kept in bank_career_440.
-- Rollback: migration/440-rollback-career-lot-type.sql
begin;
set local timezone to 'Asia/Kolkata';

alter table public.lot_templates drop constraint lot_templates_lot_category_check;
alter table public.lot_templates add constraint lot_templates_lot_category_check
  check (lot_category = any (array['technical', 'business', 'pitch', 'career']));
alter table public.tasks drop constraint tasks_lot_category_check;
alter table public.tasks add constraint tasks_lot_category_check
  check (lot_category is null or lot_category = any (array['technical', 'business', 'pitch', 'career']));

create table if not exists public.bank_career_440 (
  template_id uuid primary key, question_id uuid, why text,
  old_title text, old_scenario text, old_difficulty text, old_source_jd text, old_lot_category text, old_origin text);
alter table public.bank_career_440 enable row level security;  -- audit trail for the rollback; no policy

insert into public.bank_career_440
select t.id, q.id,
       case when r.question_id is not null then 'general bucket (341)' else 'interview question tagged Workplace Writing' end,
       t.title, t.scenario, t.difficulty, t.source_jd, t.lot_category, t.origin
  from public.question_bank q
  join public.source_content s on s.bank_question_id = q.id
  join public.lot_templates t on t.source_content_id = s.id
  left join public.bank_skill_retag_341 r on r.question_id = q.id and r.how like 'ai: general%'
 where t.origin = 'seed'
   and (r.question_id is not null or (q.skill = 'Workplace Writing' and t.title like '%{item}%'))
on conflict (template_id) do nothing;

update public.lot_templates t
   set title = left(coalesce(nullif(btrim(q.topic), ''), left(q.question, 70)), 90),
       scenario = btrim(q.question) || E'\n\n' ||
         'Your task: ' || case when q.kind = 'mcq'
           then 'Pick the best option. Then explain why it is right and why the other options are not.'
           else 'Answer this question in your own words, the way you would in a placement interview.' end || E'\n\n' ||
         'What to write: In the answer box, ' || case when q.question ~* '\d+\s*(-|to)\s*\d+\s*words'
           then 'write your answer in the length the question asks.'
           else 'write 100 to 200 words, with one real example.' end,
       difficulty = case lower(q.difficulty) when 'easy' then 'Easy' when 'hard' then 'Hard' else 'Medium' end,
       source_jd = 'Career and interview practice',
       lot_category = 'career',
       origin = 'ai',
       rubric_config_id = coalesce(t.rubric_config_id,
                                   (select id from public.task_rubric_config where is_generic_fallback limit 1))
  from public.bank_career_440 b
  join public.question_bank q on q.id = b.question_id
 where t.id = b.template_id and t.origin = 'seed';

CREATE OR REPLACE FUNCTION public.next_lot_pick(_student_id uuid, _for_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
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
  -- 236 (owner 12 Nov 2026): pitch day first asks about the student's own resume - each project, then each
  -- certification, once. Students without them (or who have done them all) get a normal pitch Lot below.
  if kind = 'pitch' then
    declare r_item text; r_kind text;
    begin
      select x.item, x.k into r_item, r_kind
        from (select left(btrim(p ->> 'title'), 80) as item, 'project' as k, 1 as o, n
                from (select projects from public.resume_claims where student_id = _student_id
                       order by created_at desc limit 1) rc,
                     jsonb_array_elements(case when jsonb_typeof(rc.projects) = 'array' then rc.projects else '[]'::jsonb end)
                       with ordinality as e(p, n)
              union all
              select left(btrim(c), 80), 'certification', 2, n
                from (select certifications from public.resume_claims where student_id = _student_id
                       order by created_at desc limit 1) rc,
                     unnest(coalesce(rc.certifications, '{}')) with ordinality as e(c, n)) x
       where coalesce(x.item, '') <> ''
         and not exists (select 1 from public.tasks k where k.student_id = _student_id
                          and k.lot_selection ->> 'resume_item' = x.item)
       order by x.o, x.n
       limit 1;
      if r_item is not null then
        select c.id, c.source_content_id into c_id, c_sc
          from public.lot_templates t join public.lot_candidates c on c.lot_template_id = t.id
         where t.source_jd = 'Written by ProofLab (resume ' || r_kind || ')' limit 1;
        if c_id is not null then
          return jsonb_build_object('version', 'lot-select-3', 'rule', 'resume_' || r_kind, 'candidate_id', c_id,
                   'source_content_id', c_sc, 'focus_skill', null, 'evidence', null, 'resume_item', r_item,
                   'why', 'Thursday is pitch day. Today you explain something from your own resume.');
        end if;
      end if;
    end;
  end if;
  if kind in ('business', 'pitch', 'saturday') then
    select p.candidate_id, p.source_content_id, p.skills into c_id, c_sc, c_sk
      from public.lot_candidate_pool(_student_id, college) p
      join public.lot_candidates c on c.id = p.candidate_id
      join public.lot_templates t on t.id = c.lot_template_id
     -- 440 (owner 12 Nov 2026): Saturday (career day) gives a Career Lot first, then business, then pitch.
     where t.lot_category = any(case when kind = 'saturday' then array['career', 'business', 'pitch']
                                 when kind = 'pitch' then array['pitch', 'business'] else array[kind] end)
     order by (t.lot_category = kind or (kind = 'saturday' and t.lot_category = 'career')) desc,
              p.own_college desc, md5(_student_id::text || p.candidate_id::text)
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
end $function$;

do $$
declare n int; a int; pick jsonb; stu uuid; sat date;
begin
  select count(*) into n from public.lot_templates t join public.bank_career_440 b on b.template_id = t.id
   where t.lot_category = 'career' and t.origin = 'ai' and t.rubric_config_id is not null and t.title not like '%{item}%';
  select count(*) into a from public.lot_candidates c join public.bank_career_440 b on b.template_id = c.lot_template_id
   where c.status = 'active';
  raise notice '440: % Career Lots, % of them pickable (moved: % general bucket, % Workplace Writing)', n, a,
    (select count(*) from public.bank_career_440 where why like 'general%'),
    (select count(*) from public.bank_career_440 where why like 'interview%');
  if n <> (select count(*) from public.bank_career_440) or a <> n or n < 119 then
    raise exception '440 self-check: expected every moved card to be an active Career Lot (% / %)', n, a;
  end if;
  -- next Saturday's pick for a student with no Career Lot yet is a Career Lot
  sat := current_date + ((6 - extract(isodow from current_date)::int + 7) % 7);
  select p.id into stu from public.student_profiles p
   where not exists (select 1 from public.tasks k where k.student_id = p.id and k.lot_category = 'career') limit 1;
  pick := public.next_lot_pick(stu, sat);
  if (select t.lot_category from public.lot_candidates c join public.lot_templates t on t.id = c.lot_template_id
       where c.id = (pick ->> 'candidate_id')::uuid) is distinct from 'career' then
    raise exception '440 self-check: Saturday pick is not a Career Lot: %', pick;
  end if;
  raise notice '440: Saturday % pick -> % (%)', sat, pick ->> 'rule', pick ->> 'why';
end $$;

notify pgrst, 'reload schema';
commit;
