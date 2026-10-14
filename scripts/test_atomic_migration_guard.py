"""Regression checks for managed-account staging migration wrappers.

No database connection. No SQL execution.
"""
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "migrations.py"

VERSIONS = [
    "100-managed-accounts-only-policies",
    "101-revoke-sessions-when-access-ends",
    "102-student-access-enforcement",
]


def generate(path):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "wrap", str(path)],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )


class AtomicMigrationGuardTests(unittest.TestCase):

    def test_three_migrations_are_atomic(self):
        for version in VERSIONS:
            with self.subTest(version=version):
                path = ROOT / "migration" / (version + ".sql")
                result = generate(path)

                self.assertEqual(result.returncode, 0, result.stderr)
                sql = result.stdout

                self.assertTrue(
                    sql.startswith("\\set ON_ERROR_STOP on\nbegin;\n")
                )
                self.assertEqual(
                    sum(x.strip().lower() == "begin;"
                        for x in sql.splitlines()), 1
                )
                self.assertEqual(
                    sum(x.strip().lower() == "commit;"
                        for x in sql.splitlines()), 1
                )
                self.assertTrue(sql.endswith("\\endif\ncommit;\n"))
                self.assertIn("pg_advisory_xact_lock", sql)
                self.assertIn("\\if :already", sql)
                self.assertIn("\\else", sql)
                self.assertIn("(ledger checksum differs)", sql)

                insert = sql.index(
                    "insert into public.schema_migrations"
                )
                commit = sql.rfind("\ncommit;")
                self.assertLess(insert, commit)

                content = path.read_text(
                    encoding="utf-8"
                ).replace("\r\n", "\n")
                digest = hashlib.sha256(
                    content.encode()
                ).hexdigest()

                self.assertIn(digest, sql)
                self.assertIn(version, sql)

    def test_invalid_transaction_structure_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / (
                "100-managed-accounts-only-policies.sql"
            )

            bad_cases = [
                "select 1;\n",
                "begin;\nselect 1;\ncommit;\ncommit;\n",
                "-- x\nbegin;\nselect 1;\n",
            ]

            for source in bad_cases:
                with self.subTest(source=source):
                    path.write_text(source, encoding="utf-8")
                    result = generate(path)
                    self.assertNotEqual(result.returncode, 0)

    def test_legacy_migration_not_auto_wrapped(self):
        path = ROOT / "migration" / "95-web-sessions.sql"
        self.assertTrue(path.is_file())

        result = generate(path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(
            "pg_advisory_xact_lock", result.stdout
        )

    def test_parked_public_signup_not_present(self):
        files = list((ROOT / "migration").glob("99-*.sql"))
        self.assertEqual(files, [])

    def test_student_sql_mirror_matches(self):
        a = ROOT / "migration" / (
            "102-student-access-enforcement.sql"
        )
        b = ROOT / "supabase" / "migrations" / (
            "20261103005200_student_access_enforcement.sql"
        )
        self.assertEqual(a.read_bytes(), b.read_bytes())

    def test_student_rollback_requires_manual_recovery(self):
        path = ROOT / "migration" / (
            "102-rollback-student-access-enforcement.sql"
        )
        self.assertIn(
            "unsafe rollback refused",
            path.read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
