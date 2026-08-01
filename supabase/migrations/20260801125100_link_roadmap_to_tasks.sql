-- Link AI-generated roadmap stages to real, completable tasks so students
-- have something concrete to finish per stage instead of just reading text.
ALTER TABLE public.tasks
  ADD COLUMN roadmap_scorecard_id UUID REFERENCES public.resume_scorecards(id) ON DELETE CASCADE,
  ADD COLUMN roadmap_stage_index INT;

CREATE INDEX idx_tasks_roadmap_scorecard ON public.tasks(roadmap_scorecard_id) WHERE roadmap_scorecard_id IS NOT NULL;
