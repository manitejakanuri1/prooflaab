"""Decides what one account-sync pass may remove. Pure: no network, no clock.

The old sync removed every student whose Google login was missing from ONE
listing, with no ceiling. A partial listing (an Identity Platform hiccup, a
paging bug) would have hard-deleted that share of all students in one pass.

Now a student is removed only when ALL of these hold:
  * their login is missing in this listing, AND
  * it was already missing in an earlier pass at least GRACE seconds ago
    (two independent listings agree, minutes apart), AND
  * this pass is not abnormal: the number missing is within the ceiling.

An abnormal pass removes nothing and says why, so it can raise an alert.
"""
from datetime import datetime, timedelta

DEFAULT_GRACE_SECONDS = 30 * 60
DEFAULT_MAX_ABS = 5          # never more than this many removals in one pass...
DEFAULT_MAX_FRACTION = 0.02  # ...or this share of students, whichever is larger


def plan(students: list[dict], logins: set[str], missing_rows: list[dict], now: datetime,
         grace_seconds: int = DEFAULT_GRACE_SECONDS, max_abs: int = DEFAULT_MAX_ABS,
         max_fraction: float = DEFAULT_MAX_FRACTION) -> dict:
    """students: [{student_id, provider_uid}]; missing_rows: [{student_id, first_missing_at}].

    Returns {abort: str|None, missing: [...ids missing now], mark: [...], clear: [...], remove: [...]}.
    """
    gone = [s for s in students if s["provider_uid"] not in logins]
    gone_ids = {s["student_id"] for s in gone}
    ceiling = max(max_abs, int(len(students) * max_fraction))
    known = {r["student_id"]: r for r in missing_rows}
    result = {
        "abort": None,
        "missing": sorted(gone_ids),
        "mark": [s for s in gone if s["student_id"] not in known],
        "clear": sorted(set(known) - gone_ids),
        "remove": [],
        "ceiling": ceiling,
    }
    if len(gone) > ceiling:
        result["abort"] = (f"{len(gone)} of {len(students)} students have no login in this listing "
                           f"(ceiling {ceiling}); nothing removed")
        result["mark"] = []
        return result
    cutoff = now - timedelta(seconds=grace_seconds)
    for s in gone:
        row = known.get(s["student_id"])
        if row and _ts(row["first_missing_at"]) <= cutoff:
            result["remove"].append(s["student_id"])
    return result


def _ts(value) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
