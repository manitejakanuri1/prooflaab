-- 331 (owner E2E 12 Nov 2026, A6): 488 of 860 live bank questions had no skill, so the picker could not give them
-- to a student for a weak skill. Free, rule-based tagging (no AI), only for questions with no skill:
--   1. the fixed skill list (tag_skills) on the linked source PAGE TITLE + SOURCE NAME (not the domain: "github.com"
--      would tag everything "Git & GitHub");
--   2. else a whole-source subject, only for sources that teach one subject.
-- Then each changed question's Lot candidate is re-synced (sync_lot_candidate puts the bank skill first), so the
-- picker sees it. Dry run on TEST: 58 by title, 204 by source = 262 tagged; 226 stay untagged (career/interview
-- advice, data-science ethics, VS Code tools - no listed skill fits; they would need AI or a new skill).
-- Rollback: migration/331-rollback-bank-question-skills-from-source.sql (puts skill back to null for these rows).
begin;
create table if not exists public.bank_skill_retag_331 (question_id uuid primary key, skill text, how text);
alter table public.bank_skill_retag_331 enable row level security;  -- audit trail for the rollback; no policy

with m(src, skill) as (values
  ('Microsoft ML for Beginners', 'Machine Learning'),
  ('Microsoft Generative AI for Beginners', 'Machine Learning'),
  ('Apna Jobs', 'Aptitude')),
u as (select q.id, r.name as rname, public.tag_skills(concat_ws(' ', c.title, r.name)) as by_title
        from public.question_bank q
        join public.source_content c on c.id = q.source_content_id
        left join public.source_registry r on r.id = c.source_id
       where q.skill is null and q.status = 'approved'),
v as (select u.id,
             case when cardinality(u.by_title) > 0 then u.by_title else array[m.skill] end as sk,
             case when cardinality(u.by_title) > 0 then 'page title' else 'source' end as how
        from u left join m on m.src = u.rname
       where cardinality(u.by_title) > 0 or m.skill is not null),
upd as (update public.question_bank q set skills = v.sk, skill = v.sk[1]
          from v where q.id = v.id returning q.id, q.skill, v.how)
insert into public.bank_skill_retag_331 select id, skill, how from upd on conflict do nothing;

select public.sync_lot_candidate(t.id)
  from public.lot_templates t
  join public.source_content s on s.id = t.source_content_id
  join public.bank_skill_retag_331 b on b.question_id = s.bank_question_id;

do $$
declare n int; left_over int; cand int;
begin
  select count(*) into n from public.bank_skill_retag_331;
  select count(*) into left_over from public.question_bank where status = 'approved' and skill is null;
  select count(*) into cand from public.lot_candidates c join public.source_content s on s.id = c.source_content_id
    join public.bank_skill_retag_331 b on b.question_id = s.bank_question_id where not (b.skill = any(c.skills));
  raise notice '331: tagged %, still untagged %, candidates missing the new skill %', n, left_over, cand;
  if n = 0 or cand > 0 then raise exception '331 self-check failed (tagged %, candidates missing skill %)', n, cand; end if;
end $$;
commit;
