-- Stage 62 — give a startup somewhere to put its own description.
--
-- The Settings screen (StartupSettingsPage.tsx) showed a Company Description
-- box, but there was no column behind it, so the field was hardcoded to a
-- sample company and the Update Profile button saved nothing at all. Adding
-- the column is what lets that screen become real rather than decorative.
--
-- Additive and nullable: no existing row changes, nothing else reads this yet.
alter table public.startup_profiles
  add column if not exists description text;

comment on column public.startup_profiles.description is
  'Free text the startup writes about itself. Shown on its own Settings screen; safe to be null.';
