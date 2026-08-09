-- Read-only code snapshot for steps whose language can't run in the
-- in-browser sandbox (Python, SQL, Java, ...) - shown as a highlighted
-- code block instead of leaving those steps with no code at all.
alter table public.level_content
  add column if not exists code_example jsonb;
