-- Why a level was ticked without ever being tested.
--
-- Placement credits a skill straight from a resume, and "your resume said so"
-- is not something a student can check or argue with. Recording the actual line
-- that matched — the skill string as they wrote it, the project it appeared in —
-- turns an assertion into evidence they can read and disagree with.
ALTER TABLE public.student_levels ADD COLUMN evidence TEXT;;
