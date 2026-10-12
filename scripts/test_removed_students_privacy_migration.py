"""Static regression for 106a + 107; 107 and 106a also enforce live DB checks."""
from pathlib import Path
p = Path(__file__).resolve().parents[1]
a = (p/'migration/106a-private-removed-students-access.sql').read_bytes()
b = (p/'supabase/migrations/20261103005650_private_removed_students_access.sql').read_bytes()
c = (p/'migration/107-consent-guard-and-login-tracking.sql').read_text()
assert a == b, '106a migration and Supabase mirror drifted'
s = a.decode()
for guard in (
    'revoke all privileges on table public.removed_students from public, anon, authenticated',
    "has_table_privilege('anon', 'public.removed_students', 'select')",
    "has_table_privilege('authenticated', 'public.removed_students', 'select')",
    "has_table_privilege('service_role', 'public.removed_students', 'insert')",
):
    assert guard in s, f'106a no longer enforces {guard}'
assert "has_table_privilege('authenticated', 'public.removed_students', 'select')" in c
assert "has_table_privilege('anon', 'public.removed_students', 'select')" in c
print('REMOVED_STUDENTS_PRIVACY_MIGRATION_GUARDS=PASS')
