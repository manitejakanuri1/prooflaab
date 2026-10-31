-- 201 (owner 31 Oct 2026, MF-012): every trace of "submit a screenshot / file" goes.
-- The upload feature was removed long ago, but some AI-written topic proof tasks (level_content.proof_brief),
-- the student tasks made from them, and their plain-words explainers still asked for a screenshot or a file.
--   1. The six known briefs are rewritten by hand for in-app work (code editor or answer box).
--   2. Any other brief or topic-proof task that still asks for a screenshot / upload / attachment loses those
--      sentences and gets one in-app line instead (covers REAL, whose briefs may differ).
--   3. Explainers that mention a screenshot are deleted; the next view writes a fresh one from the new text.
--   4. tasks.upload_deadline (left from the upload feature, written by assign_tasks, read nowhere) is dropped.
-- Old values are kept in mf012_text_backup. Rollback: migration/201-rollback-no-screenshot-wording.sql
begin;

create table if not exists public.mf012_text_backup (
  tbl text not null, row_key text not null, col text not null, old_value text, saved_at timestamptz default now()
);
alter table public.mf012_text_backup enable row level security;
revoke all on public.mf012_text_backup from public, anon, authenticated;

create or replace function pg_temp.in_app(_t text) returns text language sql immutable as $f$
  select trim(coalesce(string_agg(trim(s), ' '), '') || ' Do it in the code editor or write it in the answer box.')
  from (select m[1] s from regexp_matches(_t, '([^.!?]+[.!?]*)', 'g') m) x
  where s !~* '(screen ?shot|upload|attach|submit the [^.]*file|figma link|push the repo)'
$f$;

-- 1. hand rewrites (only where the text is still the old one)
create temp table mf012_new (level_id uuid, brief text) on commit drop;
insert into mf012_new values
 ('b237d877-9004-4cfa-a9ed-af7b53ff5780', 'In the code editor, write an index.html page that uses HTML for structure and CSS for styling. Then, in a comment at the top, explain in a few lines what happens when you type a web address and the difference between a static and a dynamic page. Done when the page shows in the preview with your styling.'),
 ('b971165d-69b3-48ce-87a6-bf8a3c6f1510', 'In the code editor, build one HTML page with a profile card: an image, a name, a short bio and a contact button. Style it with CSS using Flexbox for layout, CSS variables for colours, and a media query that changes the layout on small screens. Add alt text to the image. Done when the card looks right in the preview at both wide and narrow widths.'),
 ('970463f1-b4d7-42b0-a3a0-8e6425d801b1', 'In the answer box, explain how you would build a reusable card component in Figma with nested Auto Layout frames: a header with an avatar and title, a body with text, and a footer with two buttons. Say which frame settings make the card resize correctly at mobile, tablet and desktop widths. Done when every part and every setting is named and explained.'),
 ('3a6694fa-8cd6-402d-9495-f0a8222f3643', 'In the code editor, write a Python to-do program with add, list and done commands that keeps the tasks as JSON text. Add one command that prints only the tasks added today, using datetime. Done when running add, list and done in order prints the right tasks each time.'),
 ('6a3ec300-0fac-4caf-ab89-49d3fedba2cd', 'In the code editor, write calculator functions add and divide, plus a set_age-style check that raises ValueError on bad input. Below them, write at least five assert tests covering normal results, a raised error and division by zero. Done when running the code prints that all tests passed.'),
 ('cac5c888-0ad9-474b-9e9b-ed0fb28940cc', 'In the code editor, write a Python program that prints at least three lines about yourself using print(), with at least two comments explaining why you chose those lines. Done when it runs without errors and prints all three lines.');

insert into public.mf012_text_backup (tbl, row_key, col, old_value)
select 'level_content', level_id::text, 'proof_brief', proof_brief from public.level_content
 where proof_brief ~* '(screen ?shot|upload|attach)';
insert into public.mf012_text_backup (tbl, row_key, col, old_value)
select 'tasks', id::text, 'description', description from public.tasks
 where source = 'levels' and description ~* '(screen ?shot|upload|attach)';
insert into public.mf012_text_backup (tbl, row_key, col, old_value)
select 'task_explainers', key, 'brief', brief::text from public.task_explainers where brief::text ~* 'screen ?shot';

-- topic-proof tasks first (they repeat the old brief), then the briefs themselves
update public.tasks t set description = coalesce(n.brief, pg_temp.in_app(lc.proof_brief))
       || coalesce(substring(t.description from '\n\nFrom the .*$'), '')
  from public.level_content lc left join mf012_new n on n.level_id = lc.level_id
 where t.source = 'levels' and t.level_id = lc.level_id and t.description ~* '(screen ?shot|upload|attach)';
update public.tasks set description = pg_temp.in_app(split_part(description, E'\n\nFrom the ', 1))
       || coalesce(substring(description from '\n\nFrom the .*$'), '')
 where source = 'levels' and description ~* '(screen ?shot|upload|attach)';
update public.level_content lc set proof_brief = n.brief
  from mf012_new n where n.level_id = lc.level_id and lc.proof_brief ~* '(screen ?shot|upload|attach)';
update public.level_content set proof_brief = pg_temp.in_app(proof_brief)
 where proof_brief ~* '(screen ?shot|upload|attach)';
delete from public.task_explainers where brief::text ~* 'screen ?shot';

-- 4. the leftover upload column
alter table public.tasks drop column if exists upload_deadline;

do $$ begin
  if exists (select 1 from public.level_content where proof_brief ~* '(screen ?shot|upload|attach)') then raise exception '201: a brief still asks for a file'; end if;
  if exists (select 1 from public.tasks where source = 'levels' and description ~* '(screen ?shot|upload|attach)') then raise exception '201: a topic task still asks for a file'; end if;
  if exists (select 1 from public.task_explainers where brief::text ~* 'screen ?shot') then raise exception '201: an explainer still mentions a screenshot'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'upload_deadline') then raise exception '201: upload_deadline still there'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
