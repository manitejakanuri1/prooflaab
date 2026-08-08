-- Never pay a model twice for the same question.
--
-- Several features ask the model something that has one right answer for a given
-- input: which certificates suit a role, whether a skill set covers an interest,
-- what a help-page question means. Those are asked over and over, by different
-- students, with byte-identical prompts, and each repeat was a fresh bill for an
-- answer we already had.
--
-- Deliberately opt-in per call site rather than global: anything that is supposed
-- to vary — generated quiz questions, coding problems — must NOT be served from
-- here, or every student would sit the same test.
CREATE TABLE public.llm_cache (
  prompt_hash  TEXT PRIMARY KEY,
  feature      TEXT NOT NULL,
  response     TEXT NOT NULL,
  model        TEXT NOT NULL,
  -- How much this row has saved, so the value of caching is measurable rather
  -- than assumed.
  hits         INT NOT NULL DEFAULT 0,
  saved_tokens INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_cache_feature ON public.llm_cache(feature);

ALTER TABLE public.llm_cache ENABLE ROW LEVEL SECURITY;

-- No policies: only edge functions running as service_role touch this. A cached
-- response can contain another student's graded answer, so it is never readable
-- from the browser.
REVOKE ALL ON public.llm_cache FROM anon, authenticated;

-- Cache hits are recorded in llm_usage with zero tokens so the saving shows up
-- next to the spend it replaced.
ALTER TABLE public.llm_usage DROP CONSTRAINT IF EXISTS llm_usage_provider_check;;
