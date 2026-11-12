-- 391 (polish P2, 12 Nov 2026): the TEST seed (scripts/dev-tools/e2e_setup.py, scripts/demo/real_setup.py) gave
--   roadmap stages the action "Do one <skill> Lot a day for a week." One roadmap task is ONE written answer, so its
--   simple-words help asked for "a small practice task plus a short note" instead - the card and the task disagreed.
--   Real stages are written by resume-assessment-submit (one concrete written step) and are not touched.
--   This rewrites the seeded action on the roadmap card and on its task to one written step, and stores the
--   task's simple-words help for the new text (written here from a template - no AI call).
--   TEST data only: the seed text exists only on seeded accounts.
-- Rollback: migration/391-rollback-seeded-roadmap-action.sql
begin;

create temp table m391 on commit drop as
select t.id, t.title, t.description as old_desc,
       regexp_replace(t.description, 'Action: Do one (.+) Lot a day for a week\.$',
                      'Action: Write one small \1 practice example and a short note on what it does.') as new_desc,
       substring(t.description from 'Action: Do one (.+) Lot a day for a week\.$') as skill,
       split_part(t.description, E'\n\nAction: ', 1) as why
  from public.tasks t
 where t.roadmap_scorecard_id is not null and t.description ~ 'Action: Do one .+ Lot a day for a week\.$';

-- Simple-words help for the new text, keyed exactly as _shared/explain.ts does (sha256 of title \n description).
insert into public.task_explainers (key, brief)
select distinct encode(digest(m.title || E'\n' || m.new_desc, 'sha256'), 'hex'),
       jsonb_build_object(
         'in_one_line', 'Write one small ' || m.skill || ' example and a short note on what it does.',
         'what_it_means', m.why || ' Show that you can use ' || m.skill || ': write one small example of it in the answer box, then a short note in your own words saying what it does.',
         'steps', jsonb_build_array('Pick one simple, everyday use of ' || m.skill || '.',
                                    'Write a small example of it in the answer box.',
                                    'Add a short note saying what your example does and why it is useful.'),
         'example', null, 'words', '[]'::jsonb,
         'done_when', 'You have written one small ' || m.skill || ' example and a short note saying what it does.')
  from m391 m
on conflict (key) do nothing;

update public.tasks t set description = m.new_desc from m391 m where t.id = m.id;

update public.resume_scorecards sc
   set roadmap = (select jsonb_agg(case when st->>'action' ~ '^Do one .+ Lot a day for a week\.$'
                                        then jsonb_set(st, '{action}', to_jsonb(regexp_replace(st->>'action',
                                               '^Do one (.+) Lot a day for a week\.$',
                                               'Write one small \1 practice example and a short note on what it does.')))
                                        else st end order by ord)
                    from jsonb_array_elements(sc.roadmap::jsonb) with ordinality as e(st, ord))::text
 where sc.roadmap like '%Lot a day for a week.%';

do $$ begin
  if exists (select 1 from public.resume_scorecards where roadmap like '%Lot a day for a week.%')
     or exists (select 1 from public.tasks where roadmap_scorecard_id is not null and description ~ 'Lot a day for a week\.$') then
    raise exception '391 self-check: seeded week-long action still present';
  end if;
  if exists (select 1 from public.tasks t where t.roadmap_scorecard_id is not null
               and t.description ~ 'Action: Write one small .+ practice example and a short note on what it does\.$'
               and not exists (select 1 from public.task_explainers e
                                where e.key = encode(digest(t.title || E'\n' || t.description, 'sha256'), 'hex'))) then
    raise exception '391 self-check: a rewritten roadmap task has no simple-words help';
  end if;
end $$;

commit;
