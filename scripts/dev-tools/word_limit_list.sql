-- READ-ONLY. Every written-task checker whose word limit differs from what the task text asks for.
-- Made 11 Nov 2026 (QA retest item 4), extended in round 2 (item 7). Changes nothing.
-- Claude runs it on TEST only; the owner runs it on REAL.
-- Columns: checker_limit = what submit-written-task really accepts (task_rubric_config min/max_words);
--   checker_text_asks = a range written in the checker's own prompt; card_asks = a range in the Lot's task
--   text (tasks.description, what the student reads); vague = a length in words that is not a number
--   ("one-page sheet", "a short note") so the student cannot know the limit from the card.
-- Since round 2 the student screens show ONLY checker_limit (card text and answer box); this list is
-- for deciding whether to change the checkers themselves (a data change, needs the owner's yes).
with r as (
  select c.id, c.origin, c.is_generic_fallback, c.min_words, c.max_words, t.id as task_id, t.title,
         substring(c.prompt_text from '(?i)\d{1,4}\s*(?:–|-|to)\s*\d{2,4}\s*words?') as checker_text_asks,
         substring(t.description from '(?i)\d{1,4}\s*(?:–|-|to)\s*\d{2,4}\s*words?') as card_asks,
         substring(t.description from '(?i)\m(one|single|half|two)[- ]page\M[^.\n]{0,20}|\ma (short|brief) (note|paragraph|summary|sheet)\M') as vague
    from public.task_rubric_config c
    join public.tasks t on t.rubric_config_id = c.id
)
select id as checker, origin, is_generic_fallback, min_words || '-' || max_words as checker_limit,
       checker_text_asks, card_asks, vague, count(*) as tasks, min(title) as example_task
  from r
 where vague is not null
    or (coalesce(checker_text_asks, card_asks) is not null
        and regexp_replace(coalesce(checker_text_asks, card_asks), '(?i)^\d+\s*(?:–|-|to)\s*(\d+).*$', '\1')::int <> max_words)
    or (card_asks is not null
        and regexp_replace(card_asks, '(?i)^(\d+).*$', '\1')::int <> min_words)
 group by 1, 2, 3, 4, 5, 6, 7
 order by tasks desc, checker;
