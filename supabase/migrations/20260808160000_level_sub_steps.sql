-- Break each level into ordered sub-steps (1.1, 1.2, 1.3...) instead of one
-- atomic quiz per topic. A topic is now a group of `levels` rows sharing the
-- same (track_slug, level_number), ordered by `sub_level`.
--
-- kind='explanation' rows are read-only steps (short lesson, optionally a
-- live code sandbox) — no quiz, marked done the moment they're opened.
-- kind='checkpoint' is always the LAST sub_level of a topic: the small quiz
-- that actually tests the topic, plus the combined real task. This is the
-- only row type that keeps the old cleared/mastered-on-quiz-pass behavior.
--
-- Existing 137 rows default to sub_level=1, kind='checkpoint' — unchanged
-- behavior until they're explicitly regenerated into sub-steps, so nothing
-- breaks for students mid-topic today.

ALTER TABLE public.levels
  ADD COLUMN sub_level INT NOT NULL DEFAULT 1,
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'checkpoint' CHECK (kind IN ('explanation', 'checkpoint'));

ALTER TABLE public.levels DROP CONSTRAINT levels_track_slug_level_number_key;
ALTER TABLE public.levels ADD CONSTRAINT levels_track_slug_level_number_sub_level_key
  UNIQUE (track_slug, level_number, sub_level);

DROP INDEX IF EXISTS idx_levels_track;
CREATE INDEX idx_levels_track ON public.levels(track_slug, level_number, sub_level);

-- A live embedded code sandbox (StackBlitz) beside the explanation, only for
-- steps where it makes sense (HTML/CSS/JS/Python-ish topics). Null everywhere
-- else — most topics (networking, soft skills) have nothing to type.
ALTER TABLE public.level_content
  ADD COLUMN sandbox JSONB;

-- explanation-kind rows have no quiz/proof — quiz defaults to an empty array,
-- proof_title/brief become nullable instead of forced empty strings.
ALTER TABLE public.level_content ALTER COLUMN quiz SET DEFAULT '[]'::jsonb;
ALTER TABLE public.level_content ALTER COLUMN proof_title DROP NOT NULL;
ALTER TABLE public.level_content ALTER COLUMN proof_brief DROP NOT NULL;
