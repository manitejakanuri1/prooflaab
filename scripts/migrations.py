"""Migration authority (Wave 9). One list, one order, one checksum per file.

    python scripts/migrations.py check                 # CI: the repository is consistent
    python scripts/migrations.py plan                  # prints version + checksum, in order
    python scripts/migrations.py wrap <file.sql>       # SQL that applies one file through the ledger

The authority is migration/NN[x]-name.sql. Rollbacks (NN-rollback-*), step* runbooks,
*-production-* and *rehearsal* files are not migrations. From 50 on, each migration has an identical copy
under supabase/migrations/ (project rule) and a rollback or rollback note.
"""
import hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(ROOT, "migration")
MIRROR = os.path.join(ROOT, "supabase", "migrations")
NAME = re.compile(r"^(\d+)([a-z]?)-(?!rollback)(.+)\.sql$")
LEDGER_FROM = 50          # the stabilization branch; earlier files predate the mirror/self-check rule


def text(path):
    return open(path, encoding="utf-8").read().replace("\r\n", "\n")


def checksum(path):
    return hashlib.sha256(text(path).encode()).hexdigest()


def migrations():
    out = []
    for f in os.listdir(MIG):
        m = NAME.match(f)
        if not m or "-production-" in f or "rehearsal" in f or f.startswith("step"):
            continue
        out.append((int(m.group(1)), m.group(2), f))
    return sorted(out)


def check():
    problems = []
    seen = {}
    mirror_sums = {checksum(os.path.join(MIRROR, f)): f for f in os.listdir(MIRROR) if f.endswith(".sql")}
    for num, letter, f in migrations():
        key = (num, letter)
        if key in seen:
            problems.append(f"two migrations share the number {num}{letter}: {seen[key]} and {f}")
        seen[key] = f
        if num < LEDGER_FROM:
            continue
        body = text(os.path.join(MIG, f))
        if "do $$" not in body:
            problems.append(f"{f}: no `do $$` self-check")
        if checksum(os.path.join(MIG, f)) not in mirror_sums:
            problems.append(f"{f}: no identical copy under supabase/migrations/")
        if not any(r.startswith(f"{num}{letter}-rollback") or r.startswith(f"{num}-rollback") for r in os.listdir(MIG)) and num not in NO_ROLLBACK:
            problems.append(f"{f}: no rollback file or rollback note")
    return problems


# Additive or superseded files whose undo is described in a later/other file.
NO_ROLLBACK = {57}        # 57 (freeze covers resume evaluators) is undone by 52-rollback


def wrap(path):
    version = os.path.basename(path)[:-4]
    body, digest = text(path), checksum(path)
    return f"""\\set ON_ERROR_STOP on
create table if not exists public.schema_migrations (
  version text primary key, checksum text not null, applied_at timestamptz not null default now(),
  applied_by text not null default current_user, note text);
do $ledger$ begin
  if exists (select 1 from public.schema_migrations where version = '{version}' and checksum <> '{digest}') then
    raise exception 'migration {version} was changed after it was applied (ledger checksum differs)';
  end if;
end $ledger$;
select exists (select 1 from public.schema_migrations where version = '{version}') as already \\gset
\\if :already
  \\echo 'LEDGER: {version} already applied - skipped'
\\else
{body}
  insert into public.schema_migrations (version, checksum) values ('{version}', '{digest}');
  \\echo 'LEDGER: {version} applied and recorded'
\\endif
"""


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check":
        p = check()
        for line in p:
            print("PROBLEM:", line)
        print(f"{len(migrations())} migrations, {sum(1 for n, _, _ in migrations() if n >= LEDGER_FROM)} under the ledger rules, {len(p)} problems")
        sys.exit(1 if p else 0)
    elif cmd == "plan":
        for num, letter, f in migrations():
            if num >= LEDGER_FROM:
                print(f[:-4], checksum(os.path.join(MIG, f)))
    elif cmd == "wrap":
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        sys.stdout.write(wrap(sys.argv[2]))
    elif cmd == "baseline":
        # SQL that records already-applied files without running them (first use of the ledger).
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        upto = int(sys.argv[2])
        rows = ",\n".join(f"  ('{f[:-4]}', '{checksum(os.path.join(MIG, f))}', 'baseline: applied before the ledger existed')"
                          for num, letter, f in migrations() if LEDGER_FROM <= num <= upto)
        sys.stdout.write(f"insert into public.schema_migrations (version, checksum, note) values\n{rows}\non conflict (version) do nothing;\nselect count(*) as ledger_rows from public.schema_migrations;\n")
