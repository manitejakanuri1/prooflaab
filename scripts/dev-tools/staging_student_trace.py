"""STAGING ONLY. "What happened to Student X?" - one student's full chain from a load stage.

    python scripts/dev-tools/staging_student_trace.py <stage> <student-number> [...]

identity -> college / squad -> task -> every request the student's session made (time, kind, HTTP,
ms) -> submissions (score, verdicts) -> recordings (attempt, bound submission, score, content match)
-> what their own Build-log query returns. Prints Markdown.
"""
import glob, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

stage = int(sys.argv[1])
OUT = os.path.join("e2e-out", "load2k")
reqs = [json.loads(l) for f in glob.glob(os.path.join(OUT, f"s{stage}-p*.jsonl")) for l in open(f, encoding="utf-8") if l.strip()]
plan = {p["n"]: p for p in json.load(open(os.path.join(OUT, f"s{stage}-plan.json")))}
for n in map(int, sys.argv[2:]):
    s = f"10ad0000-0000-4000-8000-{n:012d}"
    p = plan[n]
    prof = st.call("svc", "GET", f"student_profiles?select=id,user_id,full_name,college_id,branch,cohort,colleges(name)&id=eq.{s}")[1][0]
    sq = st.call("svc", "GET", f"squad_members?select=squad_id,squads(name)&student_id=eq.{s}")[1]
    task = st.call("svc", "GET", f"tasks?select=id,student_id,title,sandbox_config_id,rubric_config_id,grading_type&id=eq.{p['task']}")[1][0]
    subs = st.call("svc", "GET", f"task_submissions?select=id,student_id,status,sandbox_score,passed_count,total_count,runner,rubric_scores,flags,created_at,details&task_id=eq.{p['task']}&order=created_at")[1]
    vs = st.call("svc", "GET", f"voice_explanations?select=id,student_id,submission_id,attempt_no,current_authoritative,status,communication_score,evaluation,created_at,scoring_claimed_at,storage_path&task_id=eq.{p['task']}&order=created_at")[1]
    mine = st.call(f"user:{s}", "GET", f"task_submissions?select=id,status,sandbox_score&task_id=eq.{p['task']}")[1]
    print(f"\n### Student {n}: {prof['full_name']} (`{s}`)\n")
    print(f"- College: {prof['colleges']['name']}, {prof['branch']}, cohort {prof['cohort']}; squad: {', '.join(x['squads']['name'] for x in sq) or 'none'}")
    print(f"- Task: `{task['id']}` \"{task['title']}\" owner {'= this student' if task['student_id'] == s else 'DIFFERENT: ' + task['student_id']}; evaluator {task['grading_type']}; planned submission: {p['kind']}, expected {p['expect']}")
    print("- Session requests (UTC time, kind, HTTP, ms):")
    for r in sorted((r for r in reqs if r["n"] == n and r["kind"] not in ("floor", "buildlog", "squad", "profile", "voice_poll")), key=lambda r: r["t"]):
        print(f"  - {time.strftime('%H:%M:%S', time.gmtime(r['t']))} {r['kind']} {r['code']} {r['ms']} ms")
    reads = [r for r in reqs if r["n"] == n and r["kind"] in ("floor", "buildlog", "squad", "profile", "voice_poll")]
    print(f"  - plus {len(reads)} page reads (Floor / Build-log / Squad / Profile / voice result), all {sorted({str(r['code']) for r in reads})}")
    for x in subs:
        verd = [d.get("verdict") for d in (x.get("details") or [])]
        print(f"- Submission `{x['id']}` owner {'ok' if x['student_id'] == s else 'WRONG'}: **{x['status']} {x['sandbox_score']}** "
              f"({x['passed_count']}/{x['total_count']} tests, runner {x['runner']}) {verd or [(c['criterion_id'], c['points']) for c in (x.get('rubric_scores') or [])]} flags {x['flags']}")
    for v in vs:
        ev = v.get("evaluation") or {}
        print(f"- Recording `{v['id']}` attempt {v['attempt_no']} authoritative={v['current_authoritative']} bound to "
              f"{'its own submission' if any(x['id'] == v['submission_id'] for x in subs) else 'UNKNOWN ' + str(v['submission_id'])}: "
              f"**{v['status']} {v['communication_score']}**, content match {ev.get('content_match')}, flags {ev.get('flags')}, "
              f"language {(ev.get('transcription') or {}).get('language')}, version {ev.get('evaluator_version')}")
    print(f"- Their own Build-log query returns: {[(m['status'], m['sandbox_score']) for m in mine]}")
