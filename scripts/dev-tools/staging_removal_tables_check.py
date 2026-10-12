"""STAGING ONLY. Proves student removal never reads a table that no longer exists.

Migration 105 re-created remove_students() from an older body whose backup branch read
public.proof_uploads, dropped by migration 66, so every removal failed with
`relation "public.proof_uploads" does not exist` (migration 106 is the fix). The failure was
invisible to the typechecker and to any test that did not actually remove a student, so this
check reads the LIVE definitions instead: every `public.<name>` the removal path mentions must
still exist, and the backup must keep task_submissions.

    python scripts/dev-tools/staging_removal_tables_check.py
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:400], flush=True)


# Every `public.x` named by a removal-path function, with whether x still exists as a relation
# or a function. The removal path is found by behaviour (it writes the removed_students backup),
# not by a hand-kept list, so a new removal function is covered the day it is written.
SQL = r"""
\pset pager off
\pset format unaligned
\pset fieldsep |
with fns as (
  select p.oid, p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and (p.proname like '%remove_student%' or p.prosrc like '%removed_students%')
), refs as (
  select f.sig, lower(m[1]) as obj
    from fns f, regexp_matches(f.def, 'public\.([A-Za-z_][A-Za-z0-9_]*)', 'g') m
   group by f.sig, lower(m[1])
)
select 'RM', r.sig, r.obj,
       (select count(*) from pg_class c where c.relname = r.obj and c.relnamespace = 'public'::regnamespace)
       + (select count(*) from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
           where n2.nspname = 'public' and p2.proname = r.obj)
  from refs r order by r.sig, r.obj;
select 'KEEP', f.sig,
       position('task_submissions' in f.def) > 0,
       position('removed_students' in f.def) > 0
  from (select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'remove_students') f;
"""

out = os.path.join(ROOT, "e2e-out", "removal-tables.sql")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8", newline="\n").write(SQL.lstrip())

r = subprocess.run(["bash", "scripts/dev-tools/staging_sql.sh", "e2e-out/removal-tables.sql"],
                   capture_output=True, text=True, cwd=ROOT)
ex = r.stdout.strip().split("(")[-1].rstrip(")")
# staging_sql.sh prints only the tail of the job log; read the whole execution's output here.
log = subprocess.run(f'gcloud logging read "resource.type=cloud_run_job AND '
                     f'labels.\\"run.googleapis.com/execution_name\\"={ex}" --project=prooflab-508214 '
                     f'--freshness=30m --format="value(textPayload)" --order=asc',
                     shell=True, capture_output=True, text=True).stdout

missing, seen, keeps = [], set(), []
for line in log.splitlines():
    parts = line.strip().split("|")
    if parts[0] == "RM" and len(parts) == 4:
        sig, obj, exists = parts[1], parts[2], parts[3]
        seen.add(sig)
        if exists == "0":
            missing.append(f"{sig} reads public.{obj}, which does not exist")
    elif parts[0] == "KEEP" and len(parts) == 4:
        keeps.append((parts[1], parts[2] == "t", parts[3] == "t"))

check("read the live removal path", len(seen) > 0 and r.returncode == 0,
      f"{len(seen)} function(s): {', '.join(sorted(seen))[:200]}" if seen else r.stdout[-200:])
check("removal reads no retired table", not missing, "; ".join(missing) or "every referenced object exists")
check("remove_students keeps task_submissions and writes the backup",
      bool(keeps) and all(sub and bak for _, sub, bak in keeps),
      keeps or "remove_students(uuid[],uuid,text) not found")

print(f"{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) and results else 1)
