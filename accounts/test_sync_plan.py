"""python accounts/test_sync_plan.py — exits non-zero on failure."""
from datetime import datetime, timedelta, timezone

from sync_plan import plan

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
STUDENTS = [{"student_id": f"s{i}", "provider_uid": f"p{i}"} for i in range(1000)]
ALL = {f"p{i}" for i in range(1000)}

# Nothing missing: nothing to do.
r = plan(STUDENTS, ALL, [], NOW)
assert r["abort"] is None and r["remove"] == [] and r["mark"] == [], r

# First sighting of 2 missing: only marked, never removed in the same pass.
r = plan(STUDENTS, ALL - {"p1", "p2"}, [], NOW)
assert r["remove"] == [] and [m["student_id"] for m in r["mark"]] == ["s1", "s2"], r

# Seen missing 10 min ago (inside grace): still not removed.
seen = [{"student_id": "s1", "first_missing_at": (NOW - timedelta(minutes=10)).isoformat()}]
r = plan(STUDENTS, ALL - {"p1"}, seen, NOW)
assert r["remove"] == [], r

# Seen missing 40 min ago and still missing: removed.
seen = [{"student_id": "s1", "first_missing_at": (NOW - timedelta(minutes=40)).isoformat()}]
r = plan(STUDENTS, ALL - {"p1"}, seen, NOW)
assert r["remove"] == ["s1"], r

# Came back (login present again): mark cleared, not removed.
r = plan(STUDENTS, ALL, seen, NOW)
assert r["clear"] == ["s1"] and r["remove"] == [], r

# Partial provider listing (60% returned): abort, mark nothing, remove nothing.
partial = {f"p{i}" for i in range(600)}
old = [{"student_id": f"s{i}", "first_missing_at": (NOW - timedelta(hours=2)).isoformat()} for i in range(600, 1000)]
r = plan(STUDENTS, partial, old, NOW)
assert r["abort"] and r["remove"] == [] and r["mark"] == [], r

# Ceiling scales with size: 15,000 students -> 2% = 300.
big = [{"student_id": f"s{i}", "provider_uid": f"p{i}"} for i in range(15000)]
r = plan(big, {f"p{i}" for i in range(9000)}, [], NOW)
assert r["abort"] and r["ceiling"] == 300, r

print("sync_plan: all checks passed")
