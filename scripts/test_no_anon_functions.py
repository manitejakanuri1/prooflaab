"""MF-002 regression: after 151, no migration may let logged-out callers (anon) or everyone (PUBLIC) run a function.

151 took "run" away from anon and PUBLIC on every public function except refuse_suspended (PostgREST's
pre-request gate). A later migration that grants it again fails here. Allowed: functions named in ALLOWED.
The live check on TEST: scripts/dev-tools/anon_functions_check.sql (run with staging_sql.sh).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {'refuse_suspended'}
GRANT = re.compile(
    r'grant\s+(?:all(?:\s+privileges)?|execute)\s+on\s+(?:all\s+)?(?:function|routine|procedure)s?\s+(.*?)\s+to\s+([^;]*);',
    re.I | re.S)
DEFAULT = re.compile(r'alter\s+default\s+privileges[^;]*grant[^;]*on\s+(?:functions|routines)[^;]*to\s+([^;]*);', re.I | re.S)


def opens_to_logged_out(roles):
    return any(r.strip().strip('"').lower() in ('anon', 'public') for r in roles.split(','))


def problems(sql):
    sql = re.sub(r'--[^\n]*', '', sql)
    found = []
    for target, roles in GRANT.findall(sql):
        names = set(re.findall(r'(\w+)\s*\(', target))
        if opens_to_logged_out(roles) and (not names or not names <= ALLOWED):
            found.append(' '.join(target.split())[:80])
    found += ['default privileges' for roles in DEFAULT.findall(sql) if opens_to_logged_out(roles)]
    return found


def after_151(path):
    m = re.match(r'(\d+)', path.name)
    if path.parent.name == 'migration':
        return m and int(m.group(1)) > 151 and 'rollback' not in path.name
    return m and m.group(1) > '20261103014100'


def demo():
    assert problems('grant execute on function public.tpo_home() to anon, authenticated;')
    assert problems('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO public;')
    assert problems('alter default privileges in schema public grant execute on functions to anon;')
    assert not problems('grant execute on function public.refuse_suspended() to anon;')
    assert not problems('grant execute on function public.tpo_home() to authenticated, service_role;')
    assert not problems('-- grant execute on function public.x() to anon;')


if __name__ == '__main__':
    demo()
    bad = [f'{p.relative_to(ROOT)}: {x}'
           for d in ('migration', 'supabase/migrations')
           for p in sorted((ROOT / d).glob('*.sql')) if after_151(p)
           for x in problems(p.read_text(encoding='utf-8'))]
    assert not bad, 'logged-out callers could run functions again (MF-002):\n' + '\n'.join(bad)
    print('NO_ANON_FUNCTIONS=PASS')
