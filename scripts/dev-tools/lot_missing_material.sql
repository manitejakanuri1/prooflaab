-- READ-ONLY. QA round 2 item 8 (11 Nov 2026): Lot texts that point at material the student is not shown
-- ("pick five from your practice set", "the list given", "repo excerpt", "below", "attached").
-- A Lot's material can only be in tasks.code_sample (shown as "Given"); when that is empty, the
-- reference has nothing behind it. Changes nothing. Claude runs it on TEST only; the owner runs it on REAL.
select t.lot_date, t.lot_number, p.full_name, t.title,
       substring(t.description from '(?i)[^.\n]{0,60}\m(given|attached|excerpt|below|practice set|provided)\M[^.\n]{0,40}') as the_words
  from public.tasks t
  join public.student_profiles p on p.id = t.student_id
 where t.lot_date is not null
   and coalesce(trim(t.code_sample), '') = ''
   and t.description ~* '\m(the (list|data|table|code|text|sheet|set|questions?|answers?|excerpt|notes?) (given|below|provided|attached)|(given|attached|provided) (list|data|table|code|text|sheet|set|questions?|answers?|excerpt|notes?)|excerpt|practice set|(see|shown|listed) below|attached)\M'
 order by t.lot_date desc, t.title;

-- The templates new Lots are copied from.
select l.source_content_id, l.title
  from public.lot_templates l
 where coalesce(trim(l.code_sample), '') = ''
   and l.scenario ~* '\m(the (list|data|table|code|text|sheet|set|questions?|answers?|excerpt|notes?) (given|below|provided|attached)|(given|attached|provided) (list|data|table|code|text|sheet|set|questions?|answers?|excerpt|notes?)|excerpt|practice set|(see|shown|listed) below|attached)\M'
 order by l.title;
