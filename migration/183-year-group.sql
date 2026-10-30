-- 183 (owner, 31 Oct 2026): one clear year group for every student (step 1 of "one season per year group").
--   student_profiles.batch is free text ("4th Year", "4", "3rd year", "2nd", "II", "2027"...). It now also fills
--   student_profiles.passing_out_year, which never changes, so next June a "2nd year" becomes "3rd year" by itself.
--   Courses are 4 years (B.Tech) for now. Year of study is counted from the school year (1 June, public.school_year):
--   in the 2026-27 school year, 4th year = passing out 2027, 2nd year = 2029.
--   Accepted: 1-4 / 1st..4th / I..IV / first..fourth (with or without "year"), a range "2023-2027" (last year),
--   or one 4-digit year (taken as the passing-out year). Anything else leaves passing_out_year empty.
--   Screens keep showing "2nd year" (public.year_group_label).
-- Rollback: migration/183-rollback-year-group.sql
begin;

alter table public.student_profiles add column if not exists passing_out_year integer;

-- The passing-out year a batch text means, on a given day (null if it cannot be read).
create or replace function public.passing_out_year_of(_batch text, _on date default current_date)
returns integer language plpgsql immutable set search_path = public, pg_temp as $fn$
declare t text := lower(trim(coalesce(_batch, ''))); n integer; y text[];
begin
  if t = '' then return null; end if;
  y := regexp_match(t, '((?:19|20)\d{2})\s*[-/to]+\s*((?:19|20)?\d{2})\s*$');
  if y is not null then
    return case when length(y[2]) = 2 then (left(y[1], 2) || y[2])::int else y[2]::int end;
  end if;
  y := regexp_match(t, '^\D*((?:19|20)\d{2})\D*$');
  if y is not null then return y[1]::int; end if;
  n := case
         when t ~ '^(year\s*)?(1|1st|i|first)(\s*(st|year|yr))*$' then 1
         when t ~ '^(year\s*)?(2|2nd|ii|second)(\s*(nd|year|yr))*$' then 2
         when t ~ '^(year\s*)?(3|3rd|iii|third)(\s*(rd|year|yr))*$' then 3
         when t ~ '^(year\s*)?(4|4th|iv|fourth|final)(\s*(th|year|yr))*$' then 4
       end;
  if n is null then return null; end if;
  return public.school_year(_on) + 5 - n;
end $fn$;

-- "2nd year" for a passing-out year, today. Past 4th year: "Passed out".
create or replace function public.year_group_label(_passing_out_year integer, _on date default current_date)
returns text language sql stable set search_path = public, pg_temp as $fn$
  select case
    when _passing_out_year is null then null
    when public.school_year(_on) + 5 - _passing_out_year > 4 then 'Passed out ' || _passing_out_year
    when public.school_year(_on) + 5 - _passing_out_year < 1 then 'Joins ' || (_passing_out_year - 4)
    else (array['1st','2nd','3rd','4th'])[public.school_year(_on) + 5 - _passing_out_year] || ' year'
  end;
$fn$;

create or replace function public.student_batch_sets_year()
returns trigger language plpgsql set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'INSERT' or new.batch is distinct from old.batch then
    new.passing_out_year := coalesce(public.passing_out_year_of(new.batch), case when tg_op = 'UPDATE' then old.passing_out_year end);
  end if;
  return new;
end $fn$;

drop trigger if exists student_profiles_batch_sets_year on public.student_profiles;
create trigger student_profiles_batch_sets_year
  before insert or update of batch on public.student_profiles
  for each row execute function public.student_batch_sets_year();

-- Students already imported.
select set_config('app.system_write', 'on', true);
update public.student_profiles set passing_out_year = public.passing_out_year_of(batch)
 where passing_out_year is null and public.passing_out_year_of(batch) is not null;
select set_config('app.system_write', 'off', true);

do $$
begin
  if public.passing_out_year_of('4th Year', '2026-10-31') <> 2027 or public.passing_out_year_of('2nd year', '2026-10-31') <> 2029
     or public.passing_out_year_of('III', '2026-10-31') <> 2028 or public.passing_out_year_of('2023-2027') <> 2027
     or public.passing_out_year_of('2023-27') <> 2027 or public.passing_out_year_of('2028') <> 2028
     or public.passing_out_year_of('4', '2026-10-31') <> 2027 or public.passing_out_year_of('hello') is not null
     or public.year_group_label(2029, '2026-10-31') <> '2nd year' or public.year_group_label(2029, '2027-06-01') <> '3rd year' then
    raise exception '183: year group reading is wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
