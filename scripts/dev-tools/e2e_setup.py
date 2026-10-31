"""TEST ONLY: set up PRAGATI for Grok's end-to-end test (owner, 31 Oct 2026).

Creates logins in the TEST login project, then one guarded SQL file run through staging_sql.sh:
admin + PRAGATI college passwords reset, Company A (approved) + Company B (pending), 30 students
(22 CSE-A, 8 CSE-B; 25 onboarded with a parsed resume, 5 not), 10 company opt-ins, a fresh season
with squads, and Company A's job, shortlist and sponsored Lot.
Writes all logins to the Desktop file and a 3-row import CSV next to it. Never prints a password.
The old PRAGATI students must already be removed (remove_students). Re-running creates nothing twice
for logins (it resets their passwords), but the SQL part expects a clean college.

    CLOUDSDK_CORE_ACCOUNT=deploy.openfloor@gmail.com python scripts/dev-tools/e2e_setup.py
"""
import json, os, secrets, subprocess, sys, tempfile, urllib.request

PROJECT = "prooflab-stg-identity-508214"
API = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}"
COLLEGE = "230bc44a-7608-4284-a8d6-3a2a14329241"   # PRAGATI on TEST
DESKTOP = os.path.join(os.path.expanduser("~"), "Desktop")
GUARD = ("do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') "
         "then raise exception 'not TEST'; end if; end $$;\n")

ROLES = {
    "Data Analyst":      ["Python", "SQL", "Excel", "Pandas", "Power BI"],
    "Python Developer":  ["Python", "Flask", "SQL", "Git", "REST APIs"],
    "Web Developer":     ["HTML", "CSS", "JavaScript", "React", "Git"],
    "Java Developer":    ["Java", "Spring Boot", "SQL", "OOP", "Git"],
    "Data Scientist":    ["Python", "Pandas", "NumPy", "Machine Learning", "SQL"],
    "Cloud Engineer":    ["AWS", "Linux", "Docker", "Networking", "Bash"],
    "DevOps Engineer":   ["Docker", "Kubernetes", "Linux", "Git", "CI/CD"],
    "Android Developer": ["Kotlin", "Java", "Android", "Firebase", "Git"],
}
NAMES = ["Aarav Reddy", "Divya Sharma", "Karthik Naidu", "Sneha Rao", "Rahul Varma", "Priya Iyer",
         "Vikram Chowdary", "Ananya Gupta", "Siddharth Menon", "Lakshmi Prasad", "Arjun Kumar", "Meghana Reddy",
         "Rohit Patel", "Kavya Nair", "Nikhil Joshi", "Harika Devi", "Sai Teja", "Pooja Kulkarni",
         "Varun Krishna", "Swathi Reddy", "Manoj Babu", "Bhavana Murthy",          # 22 CSE-A
         "Teja Srinivas", "Ramya Krishnan", "Ajay Goud", "Deepika Rani", "Surya Prakash", "Keerthi Sai",
         "Naveen Raju", "Sravani Lakshmi"]                                          # 8 CSE-B
NOT_ONBOARDED = {20, 21, 22, 29, 30}       # 3 in CSE-A, 2 in CSE-B: onboarding from the start
OPT_IN = {1, 2, 3, 4, 5, 6, 7, 23, 24, 25}  # company opt-in ON


def token():
    return subprocess.check_output("gcloud auth print-access-token", shell=True, text=True).strip()


def call(tok, path, body):
    req = urllib.request.Request(API + path, json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {tok}", "x-goog-user-project": PROJECT, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")


def login(tok, email, name, uid=None):
    """Create the login, or reset the password of the one already there. Returns (localId, password)."""
    pw = "Pl-" + secrets.token_urlsafe(9)
    found = call(tok, "/accounts:lookup", {"email": [email]}).get("users") or []
    if uid is None and found:
        uid = found[0]["localId"]
    if found:
        call(tok, "/accounts:update", {"localId": uid, "password": pw, "emailVerified": True, "disableUser": False})
        return uid, pw
    made = call(tok, "/accounts", {"email": email, "password": pw, "displayName": name,
                                   "emailVerified": True, "disabled": False})
    return made["localId"], pw


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def arr(xs):
    return "array[" + ",".join(q(x) for x in xs) + "]::text[]"


def student_sql(n, uid, email, name):
    role = list(ROLES)[(n - 1) % len(ROLES)]
    skills = ROLES[role]
    cohort = "CSE-A" if n <= 22 else "CSE-B"
    roll = f"22PR1A05{n:02d}"
    onboarded = n not in NOT_ONBOARDED
    resume = (f"{name}\nB.Tech CSE, PRAGATI Engineering College, 2027\nTarget role: {role}\n"
              f"Skills: {', '.join(skills)}\n"
              f"Project: {skills[0]} mini project - built a small {role.lower()} app for the college fest.\n"
              f"Internship: 6-week summer internship, worked with {skills[1]} and {skills[2]}.")
    s = f"""
do $s$ declare uid uuid; pid uuid; cid uuid; aid uuid; begin
  uid := public.record_account({q(uid)}, {q(email)}, {q(name)}, true);
  pid := public.import_student_record(uid, {q(COLLEGE)}, {q(email)}, {q(name)}, 'CSE', '4th Year',
           {arr(skills[:3])}, '{{}}', {q('Become a ' + role)}, {q(roll)}, '4th Year', {q(f'98480{n:05d}')}, null);
  update public.student_profiles set cohort = {q(cohort)}, target_role = {q(role)} where id = pid;"""
    if onboarded:
        gap = {"verified": skills[:3], "needs_improvement": skills[3:4], "missing": skills[4:]}
        roadmap = [{"skill": k, "title": f"Practise {k}", "why": f"{role}s use {k} every day.",
                    "action": f"Do one {k} Lot a day for a week."} for k in skills[3:]]
        s += f"""
  insert into public.resume_claims (student_id, storage_path, raw_extraction, skills, projects, target_role, status,
         resume_quality_score, ats_match_score, resume_text, confirmed_at, feedback_acknowledged)
  values (pid, 'e2e/' || uid || '/resume.pdf', {q(json.dumps({"name": name, "skills": skills}))}::jsonb, {arr(skills)},
          {q(json.dumps([{"title": f"{skills[0]} mini project", "tech": skills[:2]}]))}::jsonb, {q(role)}, 'confirmed',
          {60 + n % 25}, {55 + n % 30}, {q(resume)}, now(), true)
  returning id into cid;
  insert into public.resume_assessments (student_id, resume_claims_id, status) values (pid, cid, 'graded') returning id into aid;
  insert into public.resume_scorecards (student_id, assessment_id, resume_claims_id, skill_proof_score, reasoning_score,
         interview_readiness_score, resume_quality_score, ats_match_score, skill_gap, roadmap)
  values (pid, aid, cid, {50 + n % 30}, {55 + n % 25}, {45 + n % 35}, {60 + n % 25}, {55 + n % 30},
          {q(json.dumps(gap))}::jsonb, {q(json.dumps(roadmap))});
  insert into public.student_intake (user_id, has_seen_welcome, welcome_seen_at, task_source, intake_completed_at)
  values (uid, true, now(), 'resume', now())
  on conflict (user_id) do update set task_source = 'resume', intake_completed_at = now(), has_seen_welcome = true;
  update public.student_profiles set preferred_skills = {arr(skills)}, onboarding_status = 'completed', onboarded_at = now()
   where id = pid;"""
    if n in OPT_IN:
        s += f"""
  update public.student_portfolios set is_public = true where student_id = pid;
  if not found then
    insert into public.student_portfolios (student_id, skills, bio, is_public)
    values (pid, {arr(skills)}, {q(f'Final-year CSE student aiming to be a {role}.')}, true);
  end if;"""
    return s + "\nend $s$;\n"


def company_sql(uid, email, name, approved):
    st, ver = ("active", "approved") if approved else ("pending", "pending")
    return f"""
do $c$ declare uid uuid; begin
  uid := public.record_account({q(uid)}, {q(email)}, {q(name)}, true);
  insert into public.user_roles (user_id, role, has_completed_wizard) values (uid, 'startup', true) on conflict (user_id) do nothing;
  insert into public.startups (user_id, name, email, status, verification_status)
  values (uid, {q(name)}, {q(email)}, {q(st)}, {q(ver)});
end $c$;
"""


def main():
    tok = token()
    logins = []   # (role, name, email, password)

    _, pw = login(tok, "e2e.admin@staging.prooflab.invalid", "E2E Admin", uid="staging-e2e-admin")
    logins.append(("Admin", "E2E Admin", "e2e.admin@staging.prooflab.invalid", pw))
    _, pw = login(tok, "manitejakanuri1@gmail.com", "PRAGATI")
    logins.append(("College (TPO) - PRAGATI", "PRAGATI", "manitejakanuri1@gmail.com", pw))

    sql = [GUARD, "\\set ON_ERROR_STOP 1\n\\pset tuples_only on\n\\pset format unaligned\nbegin;\n"]
    for email, name, ok in [("e2e.companyA@staging.prooflab.invalid", "Nimbus Analytics (TEST)", True),
                            ("e2e.companyB@staging.prooflab.invalid", "Kavya Labs (TEST)", False)]:
        uid, pw = login(tok, email, name)
        logins.append((f"Company {'A (approved)' if ok else 'B (pending)'}", name, email, pw))
        sql.append(company_sql(uid, email, name, ok))
    for n, name in enumerate(NAMES, 1):
        email = f"prooflab90+e2es{n:02d}@gmail.com"
        uid, pw = login(tok, email, name)
        tag = ("CSE-A" if n <= 22 else "CSE-B") + ("" if n not in NOT_ONBOARDED else ", onboarding NOT done") \
              + (", company opt-in ON" if n in OPT_IN else "")
        logins.append((f"Student {n:02d} ({tag})", name, email, pw))
        sql.append(student_sql(n, uid, email, name))

    sql.append(f"""
select 'SQUADS:' || public.form_squads({q(COLLEGE)})::text;
-- Company A: approved job, one shortlisted student, a sponsored Lot set for tomorrow
do $a$ declare co uuid; st uuid; rub uuid; r jsonb; tid uuid; begin
  select user_id into co from public.startups where email = 'e2e.companyA@staging.prooflab.invalid';
  select p.id into st from public.student_profiles p join public.student_contact c on c.student_id = p.id
   where c.email = 'prooflab90+e2es01@gmail.com';
  insert into public.job_opportunities (role, company_name, location, job_type, eligible_branch, apply_link, description,
         deadline, status, created_by, source)
  values ('Data Analyst Intern', 'Nimbus Analytics (TEST)', 'Hyderabad', 'Internship', 'CSE', 'https://prooflab-staging.web.app',
          'Six-month data analyst internship: SQL, Excel and dashboards. TEST data.', current_date + 21, 'approved', co, 'startup');
  insert into public.recruiter_shortlists (recruiter_id, student_id, stage, note) values (co, st, 'saved', 'Strong SQL resume');
  select id into rub from public.task_rubric_config where not is_generic_fallback order by created_at desc limit 1;
  r := public.company_create_lot(co, array[st], 'Sales dashboard summary',
         'Our sales team has a table of monthly orders. Write the SQL that returns each month''s total revenue and the best-selling product, then explain in 5 lines what the numbers tell a manager.',
         '', 'Correct SQL; clear explanation for a non-technical manager.', 3, null, rub);
  tid := (r->'task_ids'->>0)::uuid;
  if tid is null then raise exception 'company Lot not made: %', r; end if;
  -- MF-013: put it 1 day ahead so the notice must say the real day
  update public.tasks set lot_date = (now() at time zone 'Asia/Kolkata')::date + 1 where id = tid;
  update public.notifications set message = 'A company has set you a piece of work. It will be on your Daily Card on '
         || to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'FMDay FMDD Mon')
         || ' (one Lot a day). Until then it is in Your Tasks. They will review what you submit.',
         link = '/student/tasks/assigned?open=' || tid
   where type = 'sponsored_task' and user_id = st;
  raise notice 'LOT:%', tid;
end $a$;
commit;
select 'SEASON:' || s.id || '|' || s.name || '|' || s.created_at from public.seasons s
 where s.college_id = {q(COLLEGE)} and s.status <> 'complete';
select 'WEEK:' || w || '|' || to_char(b.starts_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || '|'
       || to_char(b.ends_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')
  from public.seasons s, generate_series(1, s.planned_weeks) w, public.season_week_bounds(s.id, w) b
 where s.college_id = {q(COLLEGE)} and s.status <> 'complete' order by w;
select 'SQUAD:' || q.cohort || '|' || q.name || '|' || string_agg(p.full_name, ', ' order by p.full_name)
  from public.squads q join public.seasons s on s.id = q.season_id
  join public.squad_members m on m.squad_id = q.id and m.left_at is null join public.student_profiles p on p.id = m.student_id
 where s.college_id = {q(COLLEGE)} group by q.cohort, q.name order by 1;
select 'RESERVE:' || coalesce(p.cohort, '-') || '|' || count(*) from public.student_profiles p
 where p.college_id = {q(COLLEGE)} and not exists (select 1 from public.squad_members m where m.student_id = p.id and m.left_at is null)
 group by p.cohort;
select 'COUNT:' || (select count(*) from public.student_profiles where college_id = {q(COLLEGE)}) || ' students, '
       || (select count(*) from public.student_profiles where college_id = {q(COLLEGE)} and onboarding_status = 'completed') || ' onboarded, '
       || (select count(*) from public.student_portfolios f join public.student_profiles p on p.id = f.student_id
            where p.college_id = {q(COLLEGE)} and f.is_public) || ' opted in';
select 'LOTDATE:' || t.lot_date from public.tasks t where t.source = 'sponsored' and t.student_id in
       (select student_id from public.student_contact where email = 'prooflab90+e2es01@gmail.com');
select 'BANK:' || count(*) from public.question_bank where status = 'approved';
""")

    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write("".join(sql))
    here = os.path.dirname(os.path.abspath(__file__))
    out = subprocess.run(["bash", os.path.join(here, "staging_sql.sh").replace("\\", "/"), f.name.replace("\\", "/")], capture_output=True, text=True)
    os.unlink(f.name)

    with open(os.path.join(DESKTOP, "prooflab_e2e_logins.txt"), "w", encoding="utf-8") as f:
        f.write("ProofLab TEST website logins (https://prooflab-staging.web.app) - TEST ONLY, made 31 Oct 2026\n\n")
        for role, name, email, pw in logins:
            f.write(f"{role}\n  Name: {name}\n  Email: {email}\n  Password: {pw}\n\n")
    with open(os.path.join(DESKTOP, "prooflab_e2e_import.csv"), "w", encoding="utf-8", newline="") as f:
        f.write("name,email,roll_number,section,phone\n"
                "Gautham Reddy,prooflab90+e2eimport1@gmail.com,22PR1A0531,CSE-B,9848000031\n"
                "Nandini Rao,prooflab90+e2eimport2@gmail.com,22PR1A0532,CSE-B,9848000032\n"
                # MF-123: same roll number as student 01 (Aarav Reddy), different email
                "Aarav R,prooflab90+e2eimport3@gmail.com,22PR1A0501,CSE-A,9848000033\n")

    for line in (out.stdout + out.stderr).splitlines():
        if line.split(":")[0] in {"SQUADS", "SEASON", "WEEK", "SQUAD", "RESERVE", "COUNT", "LOTDATE", "BANK"} \
           or "LOT:" in line or "ERROR" in line or "exit=" in line:
            print(line)
    sys.exit(out.returncode)


if __name__ == "__main__":
    main()
