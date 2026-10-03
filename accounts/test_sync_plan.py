"""python accounts/test_sync_plan.py - exits non-zero on failure."""
from datetime import datetime, timedelta, timezone

from sync_plan import Limits, plan

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def roster(n):
    return [{"student_id": f"s{i}", "provider_uid": f"p{i}"} for i in range(n)], {f"p{i}" for i in range(n)}


def old(ids, minutes=40, suspended=False):
    return [{"student_id": i, "first_missing_at": (NOW - timedelta(minutes=minutes)).isoformat(),
             "suspended_at": NOW.isoformat() if suspended else None} for i in ids]


S, L = roster(1000)

# 0 missing: nothing to do.
r = plan(S, L, [], NOW)
assert not any([r["abort"], r["review"], r["mark"], r["suspend"], r["restore"]]), r

# 1 missing, first sighting: marked only - never suspended in the same pass.
r = plan(S, L - {"p1"}, [], NOW)
assert [m["student_id"] for m in r["mark"]] == ["s1"] and r["suspend"] == [], r

# 1 missing inside the grace period: still nothing.
r = plan(S, L - {"p1"}, old(["s1"], minutes=10), NOW)
assert r["suspend"] == [], r

# 1 missing after the grace period: suspended (never deleted - plan has no delete).
r = plan(S, L - {"p1"}, old(["s1"]), NOW)
assert r["suspend"] == ["s1"] and "delete" not in r, r

# Already suspended and still missing: not suspended twice.
r = plan(S, L - {"p1"}, old(["s1"], suspended=True), NOW)
assert r["suspend"] == [], r

# Login came back: restored and cleared.
r = plan(S, L, old(["s1"], suspended=True), NOW)
assert r["restore"] == ["s1"] and r["clear"] == ["s1"], r

# 5 missing past grace: above the ceiling of 3 -> nobody suspended, admin review.
five = [f"s{i}" for i in range(5)]
r = plan(S, L - {f"p{i}" for i in range(5)}, old(five), NOW)
assert r["suspend"] == [] and r["review"], r

# 3 missing past grace: exactly the ceiling -> suspended.
r = plan(S, L - {"p0", "p1", "p2"}, old(["s0", "s1", "s2"]), NOW)
assert sorted(r["suspend"]) == ["s0", "s1", "s2"], r

# Sudden 50 missing: abnormal-drop guard (max(25, 5% of 1000 = 50)) -> 50 is allowed to be
# MARKED but not suspended (ceiling), 51 trips the guard.
r = plan(S, L - {f"p{i}" for i in range(51)}, [], NOW)
assert r["abort"] and r["mark"] == [], r

# 2% of 15,000 (300) missing: abnormal (guard 750 for 15k is 5%... 300 < 750) -> marked,
# but even after grace the ceiling of 3 stops any suspension.
big, BL = roster(15000)
gone = {f"p{i}" for i in range(300)}
r = plan(big, BL - gone, old([f"s{i}" for i in range(300)]), NOW)
assert r["suspend"] == [] and r["review"], r

# 50% missing: abort.
r = plan(S, {f"p{i}" for i in range(500)}, [], NOW)
assert r["abort"], r

# Empty provider response: abort.
r = plan(S, set(), old(["s1"], suspended=True), NOW)
assert r["abort"] and r["restore"] == [], r

# Protected test accounts are never marked or suspended.
r = plan(S, L - {"p7"}, old(["s7"]), NOW, protected={"s7"})
assert r["suspend"] == [] and r["mark"] == [], r

# Thresholds are configuration.
r = plan(S, L - {f"p{i}" for i in range(5)}, old(five), NOW, Limits(max_suspend=5))
assert len(r["suspend"]) == 5, r

print("sync_plan: all checks passed")
