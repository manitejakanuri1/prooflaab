-- MF-023 + owner rule (30 Oct 2026) check, TEST only. Everything ROLLS BACK: nothing is kept.
--   Admin and the student's own college always see all finished work: code / written answer, voice words, recording.
--   Another college sees nothing. A company sees a student only when the student's ONE switch is on, and then all
--   finished work too, but never weak areas. A recording plays for admin and the college; for a company only when
--   the switch is on (no second "audio" switch).
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/work_visibility_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (k text, v text);
create temp table who as
select (select id from auth.users where email = 'karthik.mehta@example.com') as student,
       (select id from auth.users where email = 'manitejakanuri1@gmail.com') as own_college,
       (select c.user_id from public.colleges c where c.name = 'Manager Demo College') as other_college,
       (select id from auth.users where email = 'e2e.admin@staging.prooflab.invalid') as admin,
       (select id from auth.users where email = 'probe.company@test.invalid') as company;
-- The student's finished written Lot gets a scored, server-transcribed recording, and one weak skill.
set local app.system_write = 'on';
update public.voice_explanations set current_authoritative = false
 where task_id = 'e35f9111-4009-443b-9512-f0f2c0abed0c' and current_authoritative;
insert into public.voice_explanations (student_id, task_id, storage_path, transcript_source)
values ((select student from who), 'e35f9111-4009-443b-9512-f0f2c0abed0c', 'check/work-visibility', 'server');
update public.voice_explanations set status = 'scored', communication_score = 70, transcript = 'I compared the numbers first.',
       current_authoritative = true, transcript_source = 'server'
 where storage_path = 'check/work-visibility';
insert into public.student_skills (student_id, skill, status) values ((select student from who), 'check-weak-skill', 'needs_improvement')
on conflict do nothing;
create temp table v as select id from public.voice_explanations where storage_path = 'check/work-visibility';
-- Start with the switch OFF (and the old "Anyone" visibility ON, as every student has by default).
insert into public.student_portfolios (student_id, is_public) values ((select student from who), false)
on conflict (student_id) do update set is_public = false;
update public.student_profiles set profile_visibility = 'public' where id = (select student from who);

create function pg_temp.as_user(_id uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', _id)::text, true);
$f$;
create function pg_temp.work_text(_j jsonb) returns text language sql as $f$ select coalesce(_j::text, '') $f$;

-- College (own): the answer text and the voice words.
select pg_temp.as_user((select own_college from who));
insert into r select '1. own college sees the written answer (want true)',
       (pg_temp.work_text(public.tpo_student_work((select student from who))) like '%Data science means%')::text;
insert into r select '1. own college sees the voice words (want true)',
       (pg_temp.work_text(public.tpo_student_work((select student from who))) like '%I compared the numbers first.%')::text;
-- Another college: nothing.
select pg_temp.as_user((select other_college from who));
insert into r select '2. other college sees the answer (want false)',
       (pg_temp.work_text(public.tpo_student_work((select student from who))) like '%Data science means%')::text;
-- Admin: everything.
select pg_temp.as_user((select admin from who));
insert into r select '3. admin sees the written answer (want true)',
       (pg_temp.work_text(public.tpo_student_work((select student from who))) like '%Data science means%')::text;
-- Recording plays for admin and the own college, not for another college (server role answers the path).
insert into r select '4. recording plays for admin (want true)',
       (public.company_voice_recording((select admin from who), (select id from v)) is not null)::text;
insert into r select '4. recording plays for own college (want true)',
       (public.company_voice_recording((select own_college from who), (select id from v)) is not null)::text;
insert into r select '4. recording plays for another college (want false)',
       (public.company_voice_recording((select other_college from who), (select id from v)) is not null)::text;

-- Company, switch OFF: not listed, no profile, no recording - even though old visibility is "Anyone".
select pg_temp.as_user((select company from who));
insert into r select '5. switch OFF: company Talent lists the student (want false)',
       exists (select 1 from public.recruiter_talent(_limit => 100) t where t.student_id = (select student from who))::text;
insert into r select '5. switch OFF: company opens the profile (want refused)',
       case when public.recruiter_proof_profile((select student from who)) ? 'error' then 'refused' else 'OPEN' end;
insert into r select '5. switch OFF: company plays the recording (want false)',
       (public.company_voice_recording((select company from who), (select id from v)) is not null)::text;
-- Company, switch ON: listed, answer + voice words, recording plays without any second switch, weak areas hidden.
update public.student_portfolios set is_public = true where student_id = (select student from who);
update public.student_profiles set share_voice_audio = false where id = (select student from who);
select pg_temp.as_user((select company from who));
insert into r select '6. switch ON: company Talent lists the student (want true)',
       exists (select 1 from public.recruiter_talent(_limit => 100) t where t.student_id = (select student from who))::text;
insert into r select '6. switch ON: company sees the written answer (want true)',
       (pg_temp.work_text(public.recruiter_proof_profile((select student from who))) like '%Data science means%')::text;
insert into r select '6. switch ON: company sees the voice words (want true)',
       (pg_temp.work_text(public.recruiter_proof_profile((select student from who))) like '%I compared the numbers first.%')::text;
insert into r select '6. switch ON: company sees a weak area (want false)',
       (pg_temp.work_text(public.recruiter_proof_profile((select student from who))) like '%check-weak-skill%')::text;
insert into r select '6. switch ON: company plays the recording, no audio switch (want true)',
       (public.company_voice_recording((select company from who), (select id from v)) is not null)::text;
-- Old visibility no longer matters: switch ON with "Only you" still lists the student (one switch only).
update public.student_profiles set profile_visibility = 'private' where id = (select student from who);
insert into r select '7. one switch only: ON + old visibility private still discoverable (want true)',
       public.student_is_discoverable((select student from who))::text;

select k as check, v as value from r order by k;
rollback;
