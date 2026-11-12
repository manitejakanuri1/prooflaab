"""Writes migration 236: pitch-day Lots from the student's own resume (a project, then a certification). No AI.
Usage: python -I gen_resume.py <out.sql> <clf_def.sql> <nlp_def.sql>"""
import json
import sys

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from gen_pitch import CRITERIA, REF, REG, SAMPLE, WHAT, q  # noqa: E402

KINDS = {
    "project": (
        "Explain your project: {item}",
        "In an interview, the interviewer looks at your resume and says: \"Tell me about your project {item}.\" "
        "They want to hear what you made and what you did yourself.\n\n"
        "Your task: Explain {item}: the problem it solves, how it works at a high level, the tools you used, the part "
        "you did yourself, one hard problem you fixed, and what you would improve next.\n\n" + WHAT,
        {"in_one_line": "Explain your own project {item} to an interviewer, in a short spoken answer.",
         "what_it_means": "The interviewer read your resume and asks about {item}. Say what problem it solves, how it "
                          "works, which tools you used, what you did yourself, one hard problem you fixed, and what you "
                          "would improve. Write it the way you would say it, about 150 to 250 words.",
         "steps": ["Say in one sentence what the project does and who it is for.",
                   "Say how it works at a high level and which tools you used.",
                   "Say clearly which part you did yourself.",
                   "Tell one hard problem and how you fixed it.",
                   "Say what you would improve next, and check it is 150 to 250 words."],
         "example": SAMPLE,
         "words": [{"word": "high level", "meaning": "the big picture, without every small detail"},
                   {"word": "interview", "meaning": "a meeting where someone asks you questions to decide if you get a job"}],
         "done_when": "You have written a 150 to 250 word spoken answer about {item}: the problem, how it works, your part, one hard problem and one improvement."}),
    "certification": (
        "Explain your certification: {item}",
        "In an interview, the interviewer looks at your resume and says: \"I see you have {item}. What did you learn "
        "from it?\" They want to know if the certificate turned into real skill.\n\n"
        "Your task: Explain what {item} covers, two things you learned from it, one place you used them or could use "
        "them in a project, and how it helps in the job you want.\n\n" + WHAT,
        {"in_one_line": "Explain what your certificate {item} taught you, in a short spoken answer for an interviewer.",
         "what_it_means": "The interviewer asks about {item} on your resume. Say what it covers, two things you "
                          "learned, where you used them or could use them, and how it helps in the job you want. "
                          "About 150 to 250 words.",
         "steps": ["Say in one sentence what the certificate covers.", "Give two things you learned from it.",
                   "Give one place you used them, or could use them, in a project.",
                   "Say how it helps in the job you want.", "Check it is 150 to 250 words."],
         "example": SAMPLE,
         "words": [{"word": "certification", "meaning": "a certificate you earned by passing a course or exam"},
                   {"word": "interview", "meaning": "a meeting where someone asks you questions to decide if you get a job"}],
         "done_when": "You have written a 150 to 250 word spoken answer on what {item} covers, two things you learned, one use and how it helps your job."}),
}

PICK = """  -- 236 (owner 12 Nov 2026): pitch day first asks about the student's own resume - each project, then each
  -- certification, once. Students without them (or who have done them all) get a normal pitch Lot below.
  if kind = 'pitch' then
    declare r_item text; r_kind text;
    begin
      select x.item, x.k into r_item, r_kind
        from (select left(btrim(p ->> 'title'), 80) as item, 'project' as k, 1 as o, n
                from (select projects from public.resume_claims where student_id = _student_id
                       order by created_at desc limit 1) rc,
                     jsonb_array_elements(case when jsonb_typeof(rc.projects) = 'array' then rc.projects else '[]'::jsonb end)
                       with ordinality as e(p, n)
              union all
              select left(btrim(c), 80), 'certification', 2, n
                from (select certifications from public.resume_claims where student_id = _student_id
                       order by created_at desc limit 1) rc,
                     unnest(coalesce(rc.certifications, '{}')) with ordinality as e(c, n)) x
       where coalesce(x.item, '') <> ''
         and not exists (select 1 from public.tasks k where k.student_id = _student_id
                          and k.lot_selection ->> 'resume_item' = x.item)
       order by x.o, x.n
       limit 1;
      if r_item is not null then
        select c.id, c.source_content_id into c_id, c_sc
          from public.lot_templates t join public.lot_candidates c on c.lot_template_id = t.id
         where t.source_jd = 'Written by ProofLab (resume ' || r_kind || ')' limit 1;
        if c_id is not null then
          return jsonb_build_object('version', 'lot-select-3', 'rule', 'resume_' || r_kind, 'candidate_id', c_id,
                   'source_content_id', c_sc, 'focus_skill', null, 'evidence', null, 'resume_item', r_item,
                   'why', 'Thursday is pitch day. Today you explain something from your own resume.');
        end if;
      end if;
    end;
  end if;
  if kind in ('business', 'pitch', 'saturday') then"""

FILL = """  -- 236: a resume Lot names the student's own project or certification; its simple explainer is copied from the
  -- stored one with the name filled in, so opening it calls no AI.
  if pick ? 'resume_item' then
    tpl.title := replace(tpl.title, '{item}', pick ->> 'resume_item');
    tpl.scenario := replace(tpl.scenario, '{item}', pick ->> 'resume_item');
    insert into public.task_explainers (key, brief)
    select encode(sha256(convert_to(tpl.title || E'\\n' || tpl.scenario, 'UTF8')), 'hex'),
           replace(e.brief::text, '{item}', translate(pick ->> 'resume_item', '"' || chr(92), ''''))::jsonb
      from public.task_explainers e where e.key = 'resume-template:' || substr(pick ->> 'rule', 8)
    on conflict (key) do nothing;
  end if;
  select count(*) + 1 into n from public.tasks where student_id = _student_id and lot_date is not null;"""


def main(out, clf_path, nlp_path):
    clf = open(clf_path, encoding="utf-8").read().strip()
    nlp = open(nlp_path, encoding="utf-8").read().strip()
    a = "  select count(*) + 1 into n from public.tasks where student_id = _student_id and lot_date is not null;"
    b = "         and not (t.sandbox_config_id is null and public.lot_text_asks_for_code(t.title, t.scenario, t.code_sample))"
    assert clf.count(a) == 1 and clf.count(b) == 1
    clf = clf.replace(a, FILL).replace(b, b + "\n         and t.title not like '%{item}%'  -- 236: resume templates are only for their own students")
    c = "  if kind in ('business', 'pitch', 'saturday') then"
    assert nlp.count(c) == 1
    nlp = nlp.replace(c, PICK)
    parts = []
    for kind, (title, scenario, brief) in KINDS.items():
        parts.append(f"""with sc as (insert into public.source_content (source_id, url, title, markdown, content_hash, fetch_method, rights_flag, visibility)
  values ('{REG}', 'prooflab://pitch/resume-{kind}', {q(title)}, {q(scenario)}, 'resume-{kind}', 'manual', 'ORIGINAL_ONLY', 'platform')
  on conflict (source_id, content_hash) do nothing returning id),
rc as (insert into public.task_rubric_config (prompt_text, criteria, min_words, max_words, pass_threshold, reference_answer, origin)
  select {q(scenario)}, {q(json.dumps(CRITERIA))}::jsonb, 150, 250, 70, {q(REF)}, 'manual' from sc returning id)
insert into public.lot_templates (title, scenario, source_jd, difficulty, estimate_minutes, lot_category, origin, xp_reward, rubric_config_id, source_content_id)
  select {q(title)}, {q(scenario)}, 'Written by ProofLab (resume {kind})', 'Easy', 20, 'pitch', 'ai', 10, rc.id, sc.id from sc, rc;
insert into public.task_explainers (key, brief) values ('resume-template:{kind}', {q(json.dumps(brief, ensure_ascii=False))}::jsonb)
  on conflict (key) do update set brief = excluded.brief;""")
    sql = f"""-- 236 (owner 12 Nov 2026, TEST): pitch-day Lots from the student's own resume, no AI.
--   Two templates ("Explain your project: <title>", "Explain your certification: <name>") with their own page,
--   checker (pass 70) and a stored explainer with {{item}} filled in at creation. Their candidates are 'retired',
--   so the shared pool never hands them out; next_lot_pick offers them on pitch day for each resume project, then
--   each certification (resume_claims, latest resume), once each (tasks.lot_selection.resume_item).
--   create_lot_for fills in the name and copies the explainer; the seed swap (222) skips these templates.
-- Rollback: migration/236-rollback-resume-pitch-lots.sql
begin;
{chr(10).join(parts)}
update public.lot_candidates set status = 'retired'
 where lot_template_id in (select id from public.lot_templates where source_jd like 'Written by ProofLab (resume %)');

{nlp};

{clf};

do $$
begin
  if (select count(*) from public.lot_templates t join public.lot_candidates c on c.lot_template_id = t.id
       where t.source_jd like 'Written by ProofLab (resume %)' and c.status = 'retired') <> 2 then
    raise exception '236 self-check: resume templates missing';
  end if;
  if position('resume_item' in pg_get_functiondef('public.next_lot_pick(uuid,date)'::regprocedure)) = 0
     or position('resume_item' in pg_get_functiondef('public.create_lot_for(uuid,date)'::regprocedure)) = 0 then
    raise exception '236 self-check: picker not updated';
  end if;
  if not exists (select 1 from pg_proc where proname = 'next_lot_pick' and proconfig @> array['TimeZone=Asia/Kolkata'])
     or not exists (select 1 from pg_proc where proname = 'create_lot_for' and proconfig @> array['TimeZone=Asia/Kolkata']) then
    raise exception '236 self-check: India time zone lost';
  end if;
end $$;
commit;
"""
    open(out, "w", encoding="utf-8", newline="\n").write(sql)
    rb = f"""-- Rollback for 236: the picker and Lot maker as before; resume templates retired (given Lots stay).
begin;
{open(nlp_path, encoding='utf-8').read().strip()};

{open(clf_path, encoding='utf-8').read().strip()};
commit;
"""
    open(out.replace("236-resume", "236-rollback-resume"), "w", encoding="utf-8", newline="\n").write(rb)


if __name__ == "__main__":
    main(*sys.argv[1:4])
