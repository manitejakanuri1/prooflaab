"""Decides what one account-sync pass may do. Pure: no network, no clock.

History: until 3 Oct 2026 the sync HARD-DELETED every student whose Google
login was missing from ONE listing, with no ceiling (F6). Now automation never
deletes anyone. The most it does is SUSPEND (student_profiles.status =
'suspended': no Lots, no leaderboard, no recruiter search; fully reversible),
and only when all of these hold:

  1. the listing looks normal - the abnormal-drop guard did not trip;
  2. the login has been missing in passes at least GRACE seconds apart
     (two independent listings agree);
  3. the number due for suspension in this pass is within MAX_SUSPEND.

Anything above MAX_SUSPEND suspends nobody and asks for admin review. A login
that reappears restores the student. Permanent deletion is a separate, manual
admin action (accounts /remove), never this job. Protected test accounts are
never touched.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class Limits:
    grace_seconds: int = 30 * 60
    # Abnormal upstream drop: more missing than this many OR this share of students
    # means the listing itself is suspect. Nothing is marked, suspended or restored.
    abnormal_abs: int = 25
    abnormal_fraction: float = 0.05
    # Most students one pass may suspend. Above it: no action + admin review.
    max_suspend: int = 3


def plan(students: list[dict], logins: set[str], ledger: list[dict], now: datetime,
         limits: Limits = Limits(), protected: set[str] = frozenset()) -> dict:
    """students: [{student_id, provider_uid}] (active or suspended-by-sync);
    ledger: [{student_id, first_missing_at, suspended_at}].

    Returns {abort, review, missing, mark, clear, suspend, restore}.
    """
    pool = [s for s in students if s["student_id"] not in protected]
    gone = [s for s in pool if s["provider_uid"] not in logins]
    gone_ids = {s["student_id"] for s in gone}
    known = {r["student_id"]: r for r in ledger}
    result = {"abort": None, "review": None, "missing": sorted(gone_ids), "mark": [], "clear": [],
              "suspend": [], "restore": []}

    if not logins:
        result["abort"] = "the login listing is empty"
        return result
    threshold = max(limits.abnormal_abs, int(len(pool) * limits.abnormal_fraction))
    if len(gone) > threshold:
        result["abort"] = (f"{len(gone)} of {len(pool)} students have no login in this listing "
                           f"(abnormal-drop guard {threshold}); nothing marked, suspended or restored")
        return result

    result["mark"] = [s for s in gone if s["student_id"] not in known]
    came_back = sorted(set(known) - gone_ids)
    result["clear"] = came_back
    result["restore"] = [i for i in came_back if known[i].get("suspended_at")]

    cutoff = now - timedelta(seconds=limits.grace_seconds)
    due = [s["student_id"] for s in gone
           if s["student_id"] in known and not known[s["student_id"]].get("suspended_at")
           and _ts(known[s["student_id"]]["first_missing_at"]) <= cutoff]
    if len(due) > limits.max_suspend:
        result["review"] = (f"{len(due)} students are due for suspension, above the ceiling of "
                            f"{limits.max_suspend}; none suspended - an admin must review")
    else:
        result["suspend"] = due
    return result


def _ts(value) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
