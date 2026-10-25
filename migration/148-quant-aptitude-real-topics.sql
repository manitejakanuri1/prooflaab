-- 148: Quantitative Aptitude topics 7 and 8 were from a Bayesian statistics book ("The Bayesian State of Mind",
-- "Introducing our first hammer: Pyro"), not aptitude. Found 25 Oct 2026 while comparing courses.
-- They are replaced by two real placement topics, Time and Work and Simple and Compound Interest.
-- Each new topic is one seed row plus its step list; the lessons are written afterwards by levels-warm,
-- exactly like every other new topic (see apply_syllabus.py).
-- No student had any progress on the old topics (student_levels: 0 rows, checked on both databases).
-- Backups: scratchpad quant-wrong-topics-{TEST,REAL}-backup.json.
begin;

delete from public.levels where track_slug = 'quant-aptitude' and level_number in (7, 8);  -- cascades lessons and step lists

with s as (insert into public.levels (track_slug, level_number, sub_level, kind, skill, title)
           values ('quant-aptitude', 7, 1, 'explanation', 'Time & Work', 'Work as a Rate: One Job in So Many Days') returning id)
insert into public.level_syllabus (level_id, why, steps)
select id, 'Placement tests often ask how long people or pipes take to finish a job, alone or together.',
       '["Work as a Rate: One Job in So Many Days", "Two or More People Working Together", "Efficiency: When One Worker Is Faster", "Work and Wages: Sharing Pay by Work Done", "Pipes and Cisterns: Filling and Leaking", "Alternate Days and Workers Who Leave Midway"]'::jsonb
  from s;

with s as (insert into public.levels (track_slug, level_number, sub_level, kind, skill, title)
           values ('quant-aptitude', 8, 1, 'explanation', 'Simple & Compound Interest', 'Simple Interest: The Basic Formula') returning id)
insert into public.level_syllabus (level_id, why, steps)
select id, 'Loans, savings and EMIs all run on interest, and aptitude tests ask about it often.',
       '["Simple Interest: The Basic Formula", "Finding the Rate, Time or Principal", "Compound Interest: Interest on Interest", "Half-Yearly and Quarterly Compounding", "Difference Between Compound and Simple Interest", "Growth and Depreciation with the Compound Formula"]'::jsonb
  from s;

do $$
begin
  if exists (select 1 from public.levels where track_slug = 'quant-aptitude' and level_number in (7, 8)
              and (title ilike '%bayes%' or title ilike '%pyro%' or title ilike '%frequentist%' or title ilike '%lambda%')) then
    raise exception '148 self-check: a Bayesian topic is still in Quantitative Aptitude';
  end if;
  if (select count(distinct level_number) from public.levels where track_slug = 'quant-aptitude') <> 8 then
    raise exception '148 self-check: Quantitative Aptitude should have 8 topics';
  end if;
  if (select count(*) from public.level_syllabus y join public.levels l on l.id = y.level_id
       where l.track_slug = 'quant-aptitude' and l.level_number in (7, 8)) <> 2 then
    raise exception '148 self-check: the two new topics need their step lists';
  end if;
end $$;

commit;
