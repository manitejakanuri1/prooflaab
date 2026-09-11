-- stage71: auto-generated grading configs, and the one terminal fallback
--
-- Every task created from now on (daily Lots, admin/college assigned tasks)
-- gets a task_sandbox_config or task_rubric_config generated and validated
-- automatically by _shared/auto-config.ts, instead of defaulting to
-- proof_uploads. That generator's own retry/downgrade chain covers almost
-- every case, but it needs one true last resort: a single, hand-reviewed
-- generic rubric config to attach when even a topic-specific rubric fails
-- validation twice, or for a brand-new Lot in the few seconds before
-- lot-writer finishes. Its pass bar is deliberately lower (60, vs the normal
-- 70/80) because it grades content it was never tailored to.
--
-- origin distinguishes the 6 hand-authored configs from earlier today
-- ('manual', the default) from ones auto-config.ts writes ('auto') and this
-- one terminal fallback ('auto_fallback') — observability only, nothing
-- queries on it yet.

alter table public.task_rubric_config
  add column if not exists is_generic_fallback boolean not null default false,
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'auto', 'auto_fallback'));

alter table public.task_sandbox_config
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'auto', 'auto_fallback'));

create unique index if not exists task_rubric_config_one_generic_fallback
  on public.task_rubric_config (is_generic_fallback)
  where is_generic_fallback;

insert into public.task_rubric_config
  (prompt_text, criteria, min_words, max_words, pass_threshold, reference_answer, is_generic_fallback, origin)
values (
  'The student was asked to complete a real-world work task as described on their task card. Grade their written submission for genuine effort, relevance to the task, and clarity of explanation.',
  $c$[
    {"id": "effort", "name": "Effort & Relevance", "description": "The answer directly addresses the task and shows real engagement with it, not a generic or evasive response.", "max_points": 40},
    {"id": "soundness", "name": "Correctness / Soundness", "description": "The explained approach is technically correct and would actually work.", "max_points": 30},
    {"id": "clarity", "name": "Clarity of Explanation", "description": "A reader unfamiliar with the task could follow the reasoning.", "max_points": 30}
  ]$c$::jsonb,
  100,
  1000,
  60,
  $r$I read the task card carefully and worked through it step by step. First I identified exactly what was being asked for and what the expected output or deliverable should look like, since getting that wrong wastes the rest of the attempt. Then I broke the work into small pieces I could tackle one at a time, checking after each piece that it actually matched what the task described rather than assuming it was fine. Where the task involved building or fixing something, I tested it against the specific situation described on the card, not just a generic case, because the card usually names a concrete constraint that a generic solution would miss. If something did not work the way I expected, I looked at exactly what happened versus what I expected, rather than guessing at a fix, and adjusted based on that difference. I kept the explanation of my approach honest about what I actually did and why, including any tradeoffs I made under the time constraint the card mentioned, rather than describing an idealized version of the work. Overall my goal was to hand back something that genuinely solves the situation described, explained clearly enough that someone reading it who was not there while I worked could follow exactly what I did and why it addresses the task.$r$,
  true,
  'auto_fallback'
)
on conflict do nothing;
