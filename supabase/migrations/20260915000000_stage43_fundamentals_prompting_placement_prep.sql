-- ============================================================================
-- Stage 43 — three new track families, seeded the same way as the original
-- twelve (see 20260818000100_stage5_seed_tracks_and_levels.sql): one row per
-- level_tracks entry, one row per skill in public.levels. Nothing else about
-- the ladder changes — level_content (lesson + quiz) is still written on
-- first visit by the existing levels-warm/level-open pipeline, which already
-- handles topics with no code to show ("conceptual steps... soft skills").
--
-- Added on request:
--   - prompt-engineering: covers "Prompting" and "Looping" (agentic/tool-use
--     looping, not for/while loop syntax - Agentic Loops is one of its skills).
--   - quant-aptitude / logical-reasoning / verbal-ability / hr-behavioral:
--     the non-technical branch from the Master Specification v2 PDF,
--     Section 12's own suggested subtopic seeding, verbatim.
--
-- These are opt-in interests, selected at onboarding exactly like Web
-- Development or Data Science are today — see the matching StudentWizard.tsx
-- edit in the same commit. A student who never picks one never sees it;
-- that mirrors how the existing twelve already work, so no new selection
-- mechanism was invented for this.
-- ============================================================================

insert into public.level_tracks (slug, name, emoji, interest, role, sort_order) values
  ('prompt-engineering',       'Prompt Engineering',       '🧠', 'Prompt Engineering',       'AI Engineer',              13),
  ('quant-aptitude',           'Quantitative Aptitude',    '🔢', 'Quantitative Aptitude',    'Placement Candidate',      14),
  ('logical-reasoning',        'Logical Reasoning',        '🧭', 'Logical Reasoning',        'Placement Candidate',      15),
  ('verbal-ability',           'Verbal Ability',           '📝', 'Verbal Ability',           'Placement Candidate',      16),
  ('hr-behavioral',            'HR & Behavioral Prep',     '🎤', 'HR & Behavioral Prep',     'Placement Candidate',      17);

insert into public.levels (track_slug, level_number, skill, title)
select t.slug, s.ord, s.skill, s.skill
from (values
  ('prompt-engineering',       array['Prompt Basics','Few-Shot Prompting','Chain-of-Thought Prompting','System Prompts','Structured Output','RAG Basics','Agentic Loops','Evaluating Prompts']),
  ('quant-aptitude',           array['Percentages','Ratios & Proportions','Time, Speed & Distance','Profit & Loss','Probability','Permutations & Combinations']),
  ('logical-reasoning',        array['Syllogisms','Blood Relations','Seating Arrangement','Coding-Decoding','Series Completion']),
  ('verbal-ability',           array['Reading Comprehension','Sentence Correction','Vocabulary in Context','Para Jumbles']),
  ('hr-behavioral',            array['STAR Response Basics','Common HR Questions','Strengths & Weaknesses Framing','Salary Negotiation Basics'])
) as t(slug, skills)
cross join lateral unnest(t.skills) with ordinality as s(skill, ord);
