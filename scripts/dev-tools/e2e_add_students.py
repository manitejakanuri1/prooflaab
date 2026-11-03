"""TEST ONLY: add 20 more PRAGATI students, e2es31-e2es50 (owner, 3 Nov 2026).

Same accounts as e2e_setup.py (login in the TEST login project, parsed resume, onboarded), no company
opt-in. 31-40 go to CSE-A, 41-50 to CSE-B; form_squads then seats them like the first 30.
Roll numbers 22PR1A0533-0552 (0531/0532 belong to the two imported students).
Appends their logins to the Desktop logins file. Never prints a password. Refuses to run on REAL.

    CLOUDSDK_CORE_ACCOUNT=deploy.openfloor@gmail.com python scripts/dev-tools/e2e_add_students.py
"""
import os, subprocess, sys, tempfile
from e2e_setup import COLLEGE, DESKTOP, GUARD, login, q, student_sql, token

NAMES = ["Abhinav Rao", "Charitha Devi", "Gopi Krishna", "Hema Latha", "Jayanth Reddy",
         "Lavanya Sri", "Mahesh Babu", "Nithya Menon", "Pranav Sai", "Revathi Naidu",       # 31-40 CSE-A
         "Sandeep Varma", "Tejaswini Rao", "Uday Kiran", "Vaishnavi Reddy", "Yashwanth Kumar",
         "Bhargav Teja", "Chandana Priya", "Dinesh Goud", "Gayathri Devi", "Kiran Chowdary"]  # 41-50 CSE-B


def main():
    tok = token()
    logins, sql = [], [GUARD, "\\set ON_ERROR_STOP 1\n\\pset tuples_only on\n\\pset format unaligned\nbegin;\n"]
    for n, name in enumerate(NAMES, 31):
        email = f"prooflab90+e2es{n:02d}@gmail.com"
        uid, pw = login(tok, email, name)
        cohort = "CSE-A" if n <= 40 else "CSE-B"
        logins.append((f"Student {n:02d} ({cohort})", name, email, pw))
        sql.append(student_sql(n, uid, email, name, cohort=cohort, roll=f"22PR1A05{n + 2:02d}",
                               phone=f"98480{n + 2:05d}"))
    sql.append(f"""
select 'SQUADS:' || public.form_squads({q(COLLEGE)})::text;
commit;
select 'SQUAD:' || q.cohort || '|' || q.name || '|' || count(*)
  from public.squads q join public.seasons s on s.id = q.season_id and s.status <> 'complete'
  join public.squad_members m on m.squad_id = q.id and m.left_at is null
 where s.college_id = {q(COLLEGE)} group by q.cohort, q.name order by 1;
select 'RESERVE:' || coalesce(p.cohort, '-') || '|' || count(*) from public.student_profiles p
 where p.college_id = {q(COLLEGE)} and not exists (select 1 from public.squad_members m where m.student_id = p.id and m.left_at is null)
 group by p.cohort;
select 'COUNT:' || count(*) || ' students, ' || count(*) filter (where onboarding_status = 'completed') || ' onboarded'
  from public.student_profiles where college_id = {q(COLLEGE)};
""")
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write("".join(sql))
    here = os.path.dirname(os.path.abspath(__file__))
    out = subprocess.run(["bash", os.path.join(here, "staging_sql.sh").replace("\\", "/"), f.name.replace("\\", "/")],
                         capture_output=True, text=True)
    os.unlink(f.name)

    if out.returncode == 0:
        with open(os.path.join(DESKTOP, "prooflab_e2e_logins.txt"), "a", encoding="utf-8") as f:
            f.write("Added 3 Nov 2026 (e2es31-e2es50, all onboarded, company opt-in off)\n\n")
            for role, name, email, pw in logins:
                f.write(f"{role}\n  Name: {name}\n  Email: {email}\n  Password: {pw}\n\n")
    for line in (out.stdout + out.stderr).splitlines():
        if line.split(":")[0] in {"SQUADS", "SQUAD", "RESERVE", "COUNT"} or "ERROR" in line or "exit=" in line:
            print(line)
    sys.exit(out.returncode)


if __name__ == "__main__":
    main()
