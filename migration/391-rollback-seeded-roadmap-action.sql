-- Rollback of 391: put the seeded "Do one <skill> Lot a day for a week." action back on the card and the task.
-- The task_explainers rows 391 added are left in place (unused once the text goes back; delete only on request).
begin;
update public.tasks
   set description = regexp_replace(description, 'Action: Write one small (.+) practice example and a short note on what it does\.$',
                                    'Action: Do one \1 Lot a day for a week.')
 where roadmap_scorecard_id is not null
   and description ~ 'Action: Write one small .+ practice example and a short note on what it does\.$';
update public.resume_scorecards
   set roadmap = regexp_replace(roadmap, 'Write one small ([^"]+) practice example and a short note on what it does\.',
                                'Do one \1 Lot a day for a week.', 'g')
 where roadmap like '%practice example and a short note on what it does.%';
commit;
