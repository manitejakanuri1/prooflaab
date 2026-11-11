-- READ-ONLY. QA round 2 item 9 (11 Nov 2026): why a correct written answer can score 0 on a rubric part.
-- submit-written-task zeroes a part's points unless the grader's "evidence" quote appears in the answer
-- EXACTLY (lower-cased substring, zeroUnquotedCredit in _shared/rubric-grading.ts). A quote that differs only in
-- line breaks, curly quotes, dashes or a "..." gap is thrown away.
-- Changes nothing. Claude runs it on TEST only; the owner runs it on REAL.

-- 1. One submission, part by part (edit the title filter for another Lot).
with s as (
  select ts.id, ts.created_at, ts.sandbox_score as score, ts.code as answer, ts.rubric_scores, t.title
    from public.task_submissions ts join public.tasks t on t.id = ts.task_id
   where t.title ilike '%flawed probability%' and ts.rubric_scores is not null
   order by ts.created_at desc limit 3
), norm as (
  select s.id, s.created_at, s.score, s.title, r->>'criterion_id' as part, (r->>'points')::numeric as points,
         r->>'evidence' as evidence,
         position(lower(r->>'evidence') in lower(s.answer)) > 0 as exact_found,
         position(regexp_replace(translate(lower(r->>'evidence'), '‘’“”–—', '''''""--'), '\s+', ' ', 'g')
                  in regexp_replace(translate(lower(s.answer), '‘’“”–—', '''''""--'), '\s+', ' ', 'g')) > 0 as found_after_tidy
    from s, jsonb_array_elements(s.rubric_scores) r
)
select created_at, title, score, part, points, exact_found, found_after_tidy, left(evidence, 160) as evidence
  from norm order by created_at desc, part;

-- 2. Every written submission: parts zeroed by the exact-quote rule that a tidy match would have kept.
with parts as (
  select ts.id, (r->>'points')::numeric as points, r->>'evidence' as ev, ts.code as answer
    from public.task_submissions ts, jsonb_array_elements(ts.rubric_scores) r
   where ts.rubric_scores is not null and jsonb_typeof(ts.rubric_scores) = 'array'
)
select count(*) filter (where points = 0 and length(ev) >= 8) as parts_scored_0_with_a_quote,
       count(*) filter (where points = 0 and length(ev) >= 8 and position(lower(ev) in lower(answer)) = 0
                          and position(regexp_replace(translate(lower(ev), '‘’“”–—', '''''""--'), '\s+', ' ', 'g')
                                       in regexp_replace(translate(lower(answer), '‘’“”–—', '''''""--'), '\s+', ' ', 'g')) > 0)
         as zeroed_but_tidy_quote_found,
       count(*) filter (where points = 0 and length(ev) >= 8 and ev ~ '\.\.\.|…') as zeroed_quote_has_a_gap,
       count(distinct id) as submissions
  from parts;
