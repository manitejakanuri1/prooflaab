"""python accounts/test_sync_plan.py - exits non-zero on failure. Every role; no network, no real account."""
from datetime import datetime, timedelta, timezone

from sync_plan import Limits, plan

NOW = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)
ROLES = ["student", "college_admin", "startup", "recruiter", "admin"]


def roster(n, roles=ROLES):
    accounts = [{"user_id": f"u{i}", "role": roles[i % len(roles)], "provider_uid": f"p{i}", "linked": True, "protected": False,
                 "ledger_status": None, "first_missing_at": None, "in_app_deletion": False} for i in range(n)]
    return accounts, {f"p{i}": False for i in range(n)}


def seen_missing(accounts, ids, minutes=40, status="observed_missing"):
    out = []
    for a in accounts:
        a = dict(a)
        if a["user_id"] in ids:
            a["ledger_status"], a["first_missing_at"] = status, (NOW - timedelta(minutes=minutes)).isoformat()
        out.append(a)
    return out


def without(logins, *uids):
    return {k: v for k, v in logins.items() if k not in uids}


def uids(rows):
    return sorted(r["user_id"] for r in rows)


A, L = roster(1000)

# 0 missing: nothing to do.
r = plan(A, L, NOW)
assert not any([r["abort"], r["review"], r["mark"], r["verify"], r["recover"]]), r

# First sighting, for EVERY role: marked only - never cut in the same pass.
for i, role in enumerate(ROLES):
    r = plan(A, without(L, f"p{i}"), NOW)
    assert uids(r["mark"]) == [f"u{i}"] and r["mark"][0]["role"] == role and r["verify"] == [], (role, r)

# Inside the grace period: still nothing.
r = plan(seen_missing(A, {"u1"}, minutes=10), without(L, "p1"), NOW)
assert r["verify"] == [] and r["mark"] == [], r

# After the grace period: a candidate for the exact lookup (cutting happens only after it).
r = plan(seen_missing(A, {"u1"}), without(L, "p1"), NOW)
assert uids(r["verify"]) == ["u1"] and "delete" not in r, r

# A DISABLED login counts as unusable, for every role.
disabled = dict(L, p2=True)
r = plan(A, disabled, NOW)
assert uids(r["mark"]) == ["u2"], r

# Already cut and still missing: not verified twice.
r = plan(seen_missing(A, {"u1"}, status="verified_missing"), without(L, "p1"), NOW)
assert r["verify"] == [] and r["mark"] == [] and r["recover"] == [], r

# The SAME login id is back: recover (both observed and verified rows).
r = plan(seen_missing(A, {"u1", "u3"}, status="verified_missing"), L, NOW)
assert uids(r["recover"]) == ["u1", "u3"], r

# Back but still disabled: not recovered.
r = plan(seen_missing(A, {"u1"}, status="verified_missing"), dict(L, p1=True), NOW)
assert r["recover"] == [], r

# A DIFFERENT login id with the same email is a different identity: the account stays missing.
r = plan(seen_missing(A, {"u1"}, status="verified_missing"), dict(without(L, "p1"), **{"new-p1": False}), NOW)
assert r["recover"] == [] and "u1" in r["missing"], r

# Ceiling: 5 due is above 3 -> nobody verified/cut, admin review.
five = {f"u{i}" for i in range(5)}
r = plan(seen_missing(A, five), without(L, *[f"p{i}" for i in range(5)]), NOW)
assert r["verify"] == [] and r["review"], r

# Exactly the ceiling (3): all three, across roles.
r = plan(seen_missing(A, {"u0", "u1", "u2"}), without(L, "p0", "p1", "p2"), NOW)
assert uids(r["verify"]) == ["u0", "u1", "u2"], r

# Burst above the abnormal-drop guard (max(25, 5% of 1000) = 50): 51 missing -> abort, nothing marked.
r = plan(A, without(L, *[f"p{i}" for i in range(51)]), NOW)
assert r["abort"] and r["mark"] == [] and r["recover"] == [], r

# Large tenant: 300 of 15,000 missing (< 750 guard) are marked, but the ceiling stops any cut.
big, BL = roster(15000)
gone = [f"p{i}" for i in range(300)]
r = plan(seen_missing(big, {f"u{i}" for i in range(300)}), without(BL, *gone), NOW)
assert r["verify"] == [] and r["review"], r

# Half the listing missing (truncated / partial page): abort.
r = plan(A, {f"p{i}": False for i in range(500)}, NOW)
assert r["abort"], r

# Empty listing: abort, and NOTHING is recovered either.
r = plan(seen_missing(A, {"u1"}, status="verified_missing"), {}, NOW)
assert r["abort"] and r["recover"] == [], r

# Protected test accounts are never marked, verified or recovered.
prot = [dict(a, protected=a["user_id"] == "u7") for a in seen_missing(A, {"u7"})]
r = plan(prot, without(L, "p7"), NOW)
assert r["verify"] == [] and r["mark"] == [], r

# An account whose app deletion is in progress is left to the deletion outbox.
busy = [dict(a, in_app_deletion=a["user_id"] == "u8") for a in A]
r = plan(busy, without(L, "p8"), NOW)
assert r["mark"] == [] and r["verify"] == [], r

# Role downgrade / change does not matter: matching is by account + exact login id only.
changed = [dict(a, role="student") if a["user_id"] == "u4" else a for a in seen_missing(A, {"u4"})]
r = plan(changed, without(L, "p4"), NOW)
assert uids(r["verify"]) == ["u4"], r

# Thresholds are configuration.
r = plan(seen_missing(A, five), without(L, *[f"p{i}" for i in range(5)]), NOW, Limits(max_suspend=5))
assert len(r["verify"]) == 5, r

# The staging shape: 15,000 synthetic students that never had a Google login (no link; their id falls back to the
# app id) next to a few real, linked logins. They are not "deleted logins": not counted, not marked, no abort.
synthetic = [{"user_id": f"x{i}", "role": "student", "provider_uid": f"x{i}", "linked": False, "protected": False,
              "ledger_status": None, "first_missing_at": None, "in_app_deletion": False} for i in range(15000)]
real, RL = roster(7)
r = plan(real + synthetic, RL, NOW)
assert not r["abort"] and r["mark"] == [] and r["missing"] == [] and r["link"] == [], r
# ... and a real Console delete among them is still found.
r = plan(real + synthetic, without(RL, "p2"), NOW)
assert not r["abort"] and uids(r["mark"]) == ["u2"], r
# An unlinked account whose own id IS a login in the listing (uuid-named August account) is linked, nothing else.
r = plan(real + synthetic[:3], dict(RL, x1=False), NOW)
assert uids(r["link"]) == ["x1"] and r["mark"] == [], r
# Nothing is linked from an aborted pass.
r = plan(real + [dict(s, linked=True) for s in synthetic[:100]], dict(RL, x1=False), NOW)
assert r["abort"] and r["link"] == [], r

print("sync_plan: all checks passed")
