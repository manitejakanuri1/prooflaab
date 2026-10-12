-- 109: the default branch list of the college's import screen (Sidhu S39). Data only; no screen or function changes.
--
-- College -> Import students has a Branch dropdown. Its choices are the default squad-naming themes
-- (tpo_naming_themes(), rows of squad_name_themes with no college), followed by "Other…", which opens a box to type
-- a branch. Those nine defaults were inserted once by stage 23 (CSE, IT, ECE, EEE, MECH, CIVIL, AIML, DS and the
-- '*' fallback). Production has them (data model, 3 Oct 2026: squad_name_themes 9 rows). The staging database has
-- none (read-only check, 12 Oct 2026: 0 rows), so on staging the dropdown holds only "Other…" and every college
-- ends up typing its branch by hand.
--
-- This adds each default that is missing and nothing else: a default that exists is left as it is, and a college's
-- own theme (college_id set) is never touched. Running it twice changes nothing.
-- Rollback: 109-rollback-default-squad-name-themes.sql (a note: the rows are not removed, see there).
begin;

insert into public.squad_name_themes (branch, theme)
select v.branch, v.theme
  from (values ('CSE', 'Titans'), ('IT', 'Intellects'), ('ECE', 'Strikers'), ('EEE', 'Chargers'),
               ('MECH', 'Warriors'), ('CIVIL', 'Builders'), ('AIML', 'Oracles'), ('DS', 'Analysts'),
               ('*', 'Challengers')) as v(branch, theme)
 where not exists (select 1 from public.squad_name_themes t where t.branch = v.branch and t.college_id is null);

do $$
declare n int;
begin
  select count(distinct branch) into n from public.squad_name_themes
   where college_id is null and branch in ('CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AIML', 'DS', '*');
  if n <> 9 then
    raise exception '109 self-check: % of the 9 default themes present', n;
  end if;
  if exists (select 1 from public.squad_name_themes where college_id is null group by branch having count(*) > 1) then
    raise exception '109 self-check: a default theme is listed twice';
  end if;
  if has_table_privilege('authenticated', 'public.squad_name_themes', 'insert')
     or has_table_privilege('anon', 'public.squad_name_themes', 'insert') then
    raise exception '109 self-check: a browser role can write the theme list';
  end if;
end $$;

commit;
