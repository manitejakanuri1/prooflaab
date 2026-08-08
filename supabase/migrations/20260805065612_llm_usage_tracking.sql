-- Per-call record of what each student costs in model tokens, and which feature
-- spent them. Written server-side from the shared LLM helper only.
CREATE TABLE IF NOT EXISTS public.llm_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.student_profiles(id) ON DELETE SET NULL,
  -- which edge function spent the tokens, e.g. 'resume-parser'
  feature text NOT NULL,
  provider text NOT NULL,            -- deepseek | gemini | kimi
  model text,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  -- true when the model hit the output cap, so a truncated answer can be
  -- distinguished from a genuinely short one when reading these numbers back
  truncated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_user_idx    ON public.llm_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_student_idx ON public.llm_usage (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_feature_idx ON public.llm_usage (feature, created_at DESC);

ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

-- Students may read their own usage; nobody may write from the client. Inserts
-- come from edge functions using the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Students read their own token usage" ON public.llm_usage;
CREATE POLICY "Students read their own token usage"
  ON public.llm_usage FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all token usage" ON public.llm_usage;
CREATE POLICY "Admins read all token usage"
  ON public.llm_usage FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Per-student totals, broken down by what spent the tokens.
CREATE OR REPLACE VIEW public.llm_usage_by_student AS
SELECT
  u.student_id,
  sp.email,
  sp.full_name,
  u.feature,
  u.provider,
  count(*)                  AS calls,
  sum(u.prompt_tokens)      AS prompt_tokens,
  sum(u.completion_tokens)  AS completion_tokens,
  sum(u.total_tokens)       AS total_tokens,
  max(u.created_at)         AS last_used
FROM public.llm_usage u
LEFT JOIN public.student_profiles sp ON sp.id = u.student_id
GROUP BY u.student_id, sp.email, sp.full_name, u.feature, u.provider;

REVOKE ALL ON public.llm_usage_by_student FROM anon;;
