-- 129: two skill tags the 22 Oct 2026 staging test batch missed.
-- "Array Loop Inventory Reporter" (a JavaScript lesson from Web-Dev-For-Beginners "2-js-basics") got no
-- tag: JavaScript matched only the words javascript / node.js / npm. It now also matches "js" as a word,
-- console.log and document. (browser JavaScript). An IndiaBix aptitude page had no skill of its own, so
-- Aptitude is added. Data only: vocabulary rows, then every candidate is re-tagged from its template.
-- Rollback: 129-rollback-skill-vocab-js-and-aptitude.sql
update public.skill_vocab
   set pattern = '\mjavascript\M|\mnode\.?js\M|\mnpm\M|\mjs\M|\mconsole\.log\M|\mdocument\.[a-z]'
 where skill = 'JavaScript';
insert into public.skill_vocab (skill, pattern) values
  ('Aptitude', '\maptitude\M|\mprofit and loss\M|\mtime and work\M|\msimple interest\M|\mlogical reasoning\M')
on conflict (skill) do update set pattern = excluded.pattern;
select public.sync_lot_candidate(lot_template_id) from public.lot_candidates where lot_template_id is not null;
do $$ begin
  if not 'JavaScript' = any(public.tag_skills('microsoft/Web-Dev-For-Beginners/2-js-basics/4-arrays-loops')) then raise exception '129: js lesson not tagged'; end if;
  if not 'JavaScript' = any(public.tag_skills('Print it with console.log')) then raise exception '129: console.log not tagged'; end if;
  if 'JavaScript' = any(public.tag_skills('Reverse a linked list in Python')) then raise exception '129: JavaScript false positive'; end if;
  if not 'Aptitude' = any(public.tag_skills('Solve three aptitude problems')) then raise exception '129: aptitude not tagged'; end if;
  if public.tag_skills('Write a SQL query with a LEFT JOIN') <> array['SQL'] then raise exception '129: SQL tag changed'; end if;
end $$;
