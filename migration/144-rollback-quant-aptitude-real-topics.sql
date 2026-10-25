-- Rollback of 144 removes the two new topics (7 Time and Work, 8 Simple and Compound Interest) and their lessons.
-- The old Bayesian topics are not put back: they were wrong. Restore them from the backup JSON only if really needed.
begin;
delete from public.levels where track_slug = 'quant-aptitude' and level_number in (7, 8);
commit;
