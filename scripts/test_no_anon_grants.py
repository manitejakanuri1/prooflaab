"""MF-002 regression: after 151/152, no migration may give logged-out callers (anon) or everyone (PUBLIC) a
function, table or sequence again.

151 took "run" away from anon and PUBLIC on every public function except refuse_suspended (PostgREST's
pre-request gate); 152 took every table and sequence permission away from them. A later migration that grants
one again fails here. Allowed: functions named in ALLOWED, and USAGE on a schema.
The live check on TEST: scripts/dev-tools/anon_grants_check.sql (run with staging_sql.sh).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {'refuse_suspended'}
GRANT = re.compile(r'grant\s+[^;]*?\s+on\s+([^;]*?)\s+to\s+([^;]*);', re.I | re.S)
ROUTINE = re.compile(r'(?:all\s+)?(?:function|routine|procedure)s?\b', re.I)


def opens_to_logged_out(roles):
    return any(r.strip().strip('"').lower() in ('anon', 'public') for r in roles.split(','))


def problems(sql):
    sql = re.sub(r'--[^\n]*', '', sql)
    found = []
    for stmt in re.findall(r'(?:alter\s+default\s+privileges[^;]*?)?grant[^;]*;', sql, re.I | re.S):
        m = GRANT.search(stmt)
        if not m or not opens_to_logged_out(m.group(2)):
            continue
        target = ' '.join(m.group(1).split())
        if target.lower().startswith('schema') and not stmt.lower().startswith('alter'):
            continue
        if ROUTINE.match(target) and not stmt.lower().startswith('alter'):
            names = set(re.findall(r'(\w+)\s*\(', target))
            if names and names <= ALLOWED:
                continue
        found.append(target[:80])
    return found


def after_152(path):
    m = re.match(r'(\d+)', path.name)
    if path.parent.name == 'migration':
        return m and int(m.group(1)) > 152 and 'rollback' not in path.name
    return m and m.group(1) > '20261103014200'


def demo():
    assert problems('grant execute on function public.tpo_home() to anon, authenticated;')
    assert problems('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO public;')
    assert problems('alter default privileges in schema public grant execute on functions to anon;')
    assert problems('grant select on public.tasks to anon;')
    assert problems('grant all on table public.tasks to authenticated, anon;')
    assert problems('grant usage, select on all sequences in schema public to anon;')
    assert problems('alter default privileges in schema public grant select on tables to anon;')
    assert not problems('grant execute on function public.refuse_suspended() to anon;')
    assert not problems('grant execute on function public.tpo_home() to authenticated, service_role;')
    assert not problems('grant select on public.tasks to authenticated;')
    assert not problems('grant usage on schema public to anon;')
    assert not problems('-- grant select on public.x to anon;')


if __name__ == '__main__':
    demo()
    bad = [f'{p.relative_to(ROOT)}: {x}'
           for d in ('migration', 'supabase/migrations')
           for p in sorted((ROOT / d).glob('*.sql')) if after_152(p)
           for x in problems(p.read_text(encoding='utf-8'))]
    assert not bad, 'logged-out callers could use functions or tables again (MF-002):\n' + '\n'.join(bad)
    print('NO_ANON_GRANTS=PASS')
