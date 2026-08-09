-- Up to 3 target roles picked once at onboarding, locked after. Replaces
-- ResumeCheckFlow asking "what role are you targeting" on every resume check.
alter table public.student_profiles
  add column if not exists target_roles text[] not null default '{}';
