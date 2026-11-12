# COPY FOR READING (11 Nov 2026). Run the original at scripts/dev-tools/real_demo/ - see scripts/demo/README.md.
"""REAL website: creates the demo college "ProofLab QA Demo" for the production E2E. Owner-run only.

Creates: 1 admin login, 1 college admin, 1 company, 12 students (onboarded with a typed resume, no AI used),
SQUADS squads in one section (QA-A), a running 12-week season on normal 7-day weeks. Company opt-ins stay off.
Before anything else it fingerprints REAL (sql/baseline.sql) so real_cleanup.sh can prove nothing else changed.
Logins go ONLY to the Desktop file. No password is ever printed or sent to the database.
Every demo email ends @qa-demo.prooflab.invalid (no mail can leave for it). No grant, policy or function is changed.

    python scripts/dev-tools/real_demo/real_setup.py
    python scripts/dev-tools/real_demo/real_setup.py --print-sql    (rehearsal: only prints the SQL, fake ids, touches nothing)
"""
import json, os, secrets, subprocess, sys, tempfile, urllib.request

SQUADS = 4     # 4 = real semi-finals in week 11. 2 = final only, no semi-final (owner's rule, migration 184).
PROJECT = "prooflab-508214"
API = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}"
DOMAIN = "qa-demo.prooflab.invalid"
COLLEGE_NAME = "ProofLab QA Demo"
HERE = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
LOGINS_FILE = os.path.join(os.path.expanduser("~"), "Desktop", "prooflab_real_logins.txt")
ROLES = [("Data Analyst", ["Python", "SQL", "Excel", "Pandas", "Power BI"]),
         ("Python Developer", ["Python", "Flask", "SQL", "Git", "REST APIs"]),
         ("Web Developer", ["HTML", "CSS", "JavaScript", "React", "Git"]),
         ("Java Developer", ["Java", "Spring Boot", "SQL", "OOP", "Git"])]


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def arr(xs):
    return "array[" + ",".join(q(x) for x in xs) + "]::text[]"


def setup_sql(a):
    """a: dict of key -> (provider uid, email, name). Same text in the rehearsal and on REAL."""
    uid = lambda k: q(a[k][0])
    em = lambda k: q(a[k][1])
    nm = lambda k: q(a[k][2])
    s = [f"""
do $a$ declare adm uuid; col uuid; com uuid; begin
  adm := public.record_account({uid('admin')}, {em('admin')}, {nm('admin')}, true);
  insert into public.user_roles (user_id, role, has_completed_wizard) values (adm, 'admin', true);
  col := public.record_account({uid('college')}, {em('college')}, {nm('college')}, true);
  perform public.provision_college_account(col, adm, {q(COLLEGE_NAME)}, {em('college')}, 'active');
  update public.colleges set verification_status = 'approved' where user_id = col;
  com := public.record_account({uid('company')}, {em('company')}, {nm('company')}, true);
  perform public.provision_company_account(com, adm, {nm('company')}, {em('company')}, 'QA');
end $a$;
"""]
    for n in range(1, 13):
        role, skills = ROLES[(n - 1) % len(ROLES)]
        k = f"s{n:02d}"
        name = a[k][2]
        resume = f"{name}\nB.Tech CSE, QA Demo College, 2027\nTarget role: {role}\nSkills: {', '.join(skills)}\n" \
                 f"Project: {skills[0]} mini project.\nInternship: 6 weeks with {skills[1]} and {skills[2]}."
        gap = {"verified": skills[:3], "needs_improvement": skills[3:4], "missing": skills[4:]}
        roadmap = [{"skill": x, "title": f"Practise {x}", "why": f"{role}s use {x} every day.",
                    "action": f"Write one small {x} practice example and a short note on what it does."} for x in skills[3:]]
        s.append(f"""
do $s$ declare u uuid; pid uuid; cid uuid; aid uuid; begin
  u := public.record_account({uid(k)}, {em(k)}, {nm(k)}, true);
  pid := public.import_student_record(u, (select id from public.colleges where name = {q(COLLEGE_NAME)}), {em(k)}, {nm(k)},
           'CSE', '4th Year', {arr(skills[:3])}, '{{}}', {q('Become a ' + role)}, {q(f'QA27{n:02d}')}, '2027', null, null);
  update public.student_profiles set cohort = 'QA-A', target_role = {q(role)}, passing_out_year = 2027 where id = pid;
  insert into public.resume_claims (student_id, storage_path, raw_extraction, skills, projects, target_role, status,
         resume_quality_score, ats_match_score, resume_text, confirmed_at, feedback_acknowledged)
  values (pid, 'qa-demo/' || u || '/resume.pdf', {q(json.dumps({"name": name, "skills": skills}))}::jsonb, {arr(skills)},
          {q(json.dumps([{"title": f"{skills[0]} mini project", "tech": skills[:2]}]))}::jsonb, {q(role)}, 'confirmed',
          {60 + n}, {55 + n}, {q(resume)}, now(), true) returning id into cid;
  insert into public.resume_assessments (student_id, resume_claims_id, status) values (pid, cid, 'graded') returning id into aid;
  insert into public.resume_scorecards (student_id, assessment_id, resume_claims_id, skill_proof_score, reasoning_score,
         interview_readiness_score, resume_quality_score, ats_match_score, skill_gap, roadmap)
  values (pid, aid, cid, {50 + n}, {55 + n}, {45 + n}, {60 + n}, {55 + n}, {q(json.dumps(gap))}::jsonb, {q(json.dumps(roadmap))});
  insert into public.student_intake (user_id, has_seen_welcome, welcome_seen_at, task_source, intake_completed_at)
  values (u, true, now(), 'resume', now())
  on conflict (user_id) do update set task_source = 'resume', intake_completed_at = now(), has_seen_welcome = true;
  update public.student_profiles set preferred_skills = {arr(skills)}, onboarding_status = 'completed', onboarded_at = now() where id = pid;
end $s$;
""")
    s.append(f"""
-- The season and the squads. Set by hand because the normal rule (11 a squad) would make 1 squad from 12 students.
do $q$ declare cid uuid; sid uuid; ids uuid[] := '{{}}'; new_id uuid; st record; i integer := 0; begin
  select id into strict cid from public.colleges where name = {q(COLLEGE_NAME)};
  sid := public.ensure_season(cid, 2027);
  for i in 1..{SQUADS} loop
    insert into public.squads (name, college_id, season_id, cohort, max_members)
    values ('QA Squad ' || i, cid, sid, 'QA-A', 12) returning id into new_id;
    ids := ids || new_id;
  end loop;
  i := 0;
  for st in select id from public.student_profiles where college_id = cid order by roll_number loop
    insert into public.squad_members (squad_id, student_id, joined_at) values (ids[i % {SQUADS} + 1], st.id, now());
    i := i + 1;
  end loop;
  perform public.generate_cohort_league(sid, false);
  perform public.recount_season(sid);
end $q$;
""")
    return "".join(s)


def accounts():
    a = {"admin": f"admin@{DOMAIN}|QA Demo Admin", "college": f"college@{DOMAIN}|{COLLEGE_NAME}",
         "company": f"company@{DOMAIN}|ProofLab QA Demo Company"}
    for n in range(1, 13):
        a[f"s{n:02d}"] = f"student{n:02d}@{DOMAIN}|QA Student {n:02d}"
    return {k: tuple(v.split("|")) for k, v in a.items()}


def main():
    acc = accounts()
    if "--print-sql" in sys.argv:
        print(setup_sql({k: (f"qa-fake-{k}", e, n) for k, (e, n) in acc.items()}))
        return

    os.environ["CLOUDSDK_CORE_ACCOUNT"] = "deploy.openfloor@gmail.com"
    tok = subprocess.check_output("gcloud auth print-access-token", shell=True, text=True).strip()

    def call(path, body):
        req = urllib.request.Request(API + path, json.dumps(body).encode(), method="POST", headers={
            "Authorization": f"Bearer {tok}", "x-goog-user-project": PROJECT, "Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"{}")

    def sh(fn_call):
        subprocess.run(["bash", "-c", f"source {HERE}/lib.sh; {fn_call}"], check=True)

    def read_runner():
        out = subprocess.run(["bash", "-c", f"source {HERE}/lib.sh; f=$(mktemp); echo \"select 'RUNNER: ' || current_user;\" > $f; real_read $f"],
                             check=True, capture_output=True, text=True).stdout
        return next(x.split(": ", 1)[1].strip() for x in out.splitlines() if x.startswith("RUNNER: "))

    print("1/3 Fingerprint of REAL (before any demo data)")
    runner = read_runner()
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(f"select set_config('qa.runner', {q(runner)}, true);\n" + open(f"{HERE}/sql/baseline.sql", encoding="utf-8").read())
    sh(f"real_write {f.name.replace(chr(92), '/')}")
    os.unlink(f.name)

    print("2/3 Logins")
    made, rows = {}, []
    for k, (email, name) in acc.items():
        if call("/accounts:lookup", {"email": [email]}).get("users"):
            sys.exit(f"{email} already exists. Run real_cleanup.sh first. Nothing more was created.")
        pw = "Pl-" + secrets.token_urlsafe(12)
        u = call("/accounts", {"email": email, "password": pw, "displayName": name, "emailVerified": True, "disabled": False})
        made[k] = (u["localId"], email, name)
        rows.append((k, name, email, pw))

    print("3/3 College, company, students, squads, season")
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(setup_sql(made))
    sh(f"real_write {f.name.replace(chr(92), '/')}")
    os.unlink(f.name)

    with open(LOGINS_FILE, "w", encoding="utf-8") as f:
        f.write("ProofLab REAL website demo logins (https://prooflab.co.in). DEMO ONLY. real_cleanup.sh removes them.\n\n")
        for k, name, email, pw in rows:
            f.write(f"{k}: {name}\n  Email: {email}\n  Password: {pw}\n\n")
    print(f"Logins saved to the Desktop file only: {LOGINS_FILE}")
    sh(f"real_read {HERE}/sql/standings.sql | grep -E '^(WEEK|STANDING|MATCH): '")


if __name__ == "__main__":
    main()
