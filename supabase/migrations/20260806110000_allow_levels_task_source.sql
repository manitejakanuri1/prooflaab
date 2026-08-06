-- Level proof tasks are written with source = 'levels' so they can be told apart
-- from admin, AI and pack tasks. The CHECK did not know about them, so every
-- insert was rejected and a student who passed a level quietly got no task —
-- the same shape of failure as the tasks.visibility default that stopped roadmap
-- tasks from ever being created.
ALTER TABLE public.tasks DROP CONSTRAINT tasks_source_check;

ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source = ANY (ARRAY['manual', 'ai', 'template', 'personalized', 'pack', 'levels']));
