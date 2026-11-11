-- READ-ONLY. Lists every written-task checker whose word limit differs from the range the task text asks for.
-- Made 11 Nov 2026 (QA retest item 4). Changes nothing. Claude does not run this on the REAL website;
-- the owner runs it there if they want the REAL list. On TEST it found:
--   328ee12b… shared fallback (origin auto_fallback) 100-1000, 91 tasks say "100 to 200 words"  -> set to 200
--   8 Lot-specific checkers whose text says "N-200 words" but max was 250/300                   -> set to 200
--   97556053… "Rewrite a Weak Resume Bullet" 40-200, text says 40-80 (left as is, not asked)
with ranges as (
  select c.id, c.min_words, c.max_words, c.origin, c.is_generic_fallback, t.id as task_id, t.title,
         coalesce(substring(c.prompt_text from '(?i)(\d{1,4})\s*(?:–|-|to)\s*\d{2,4}\s*words?'),
                  substring(t.description from '(?i)(\d{1,4})\s*(?:–|-|to)\s*\d{2,4}\s*words?'))::int as text_min,
         coalesce(substring(c.prompt_text from '(?i)\d{1,4}\s*(?:–|-|to)\s*(\d{2,4})\s*words?'),
                  substring(t.description from '(?i)\d{1,4}\s*(?:–|-|to)\s*(\d{2,4})\s*words?'))::int as text_max
    from public.task_rubric_config c
    left join public.tasks t on t.rubric_config_id = c.id
)
select id as checker, origin, is_generic_fallback, min_words || '-' || max_words as checker_limit,
       text_min || '-' || text_max as text_asks, count(task_id) as tasks, min(title) as example_task
  from ranges
 where text_max is not null and text_max <> max_words
 group by 1, 2, 3, 4, 5
 order by tasks desc;
