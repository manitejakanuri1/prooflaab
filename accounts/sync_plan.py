"""Decides what one account-sync pass may do, for EVERY role. Pure: no network, no clock.

History: until 3 Oct 2026 the sync HARD-DELETED every student whose Google login was missing from ONE
listing, with no ceiling (F6). Since then automation never deletes anyone. Since migration 110 it covers
student, college_admin, startup, recruiter and admin alike, and the strongest thing it does is CUT ACCESS
(sessions revoked, every old ticket refused; a student is also suspended) - fully reversible, and only when
all of these hold:

  1. the listing is complete and normal - not empty, and the abnormal-drop guard did not trip;
  2. the login was missing in passes at least GRACE seconds apart (two independent listings agree);
  3. the number due in this pass is within MAX_SUSPEND;
  4. an exact lookup of that one login id then says it is gone or disabled (server.py does the lookup;
     this module only names the candidates in `verify`).

Anything above MAX_SUSPEND cuts nobody and asks for admin review. The SAME login id reappearing (enabled)
restores the account; a different id with the same email is a different identity and restores nothing.
Permanent deletion is a separate, authorised app action, never this job. Protected test accounts and
accounts whose app deletion is in progress are never touched.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class Limits:
    grace_seconds: int = 30 * 60
    # Abnormal upstream drop: more missing than this many OR this share of accounts
    # means the listing itself is suspect. Nothing is marked, cut or restored.
    abnormal_abs: int = 25
    abnormal_fraction: float = 0.05
    # Most accounts one pass may cut off. Above it: no action + admin review.
    max_suspend: int = 3


def plan(accounts: list[dict], logins: dict[str, bool], now: datetime, limits: Limits = Limits()) -> dict:
    """accounts: rows of identity_sync_accounts() - {user_id, role, provider_uid, linked, protected, ledger_status,
    first_missing_at, in_app_deletion}. logins: {provider_uid: disabled} for the WHOLE scoped listing.

    Returns {abort, review, missing, mark, verify, recover, link}; each list holds account rows.
    """
    # Only GENUINELY LINKED logins are reconciled (an account_identities row: written by the bridge at sign-in,
    # by managed account creation, or by `link` below). An account that never had a Google login - e.g. the
    # 15,000 synthetic staging students - is not a deleted login, and is neither counted nor touched.
    # An unlinked account whose own id IS in the listing is a real (uuid-named) login: it gets linked.
    # On hold (owner decision): no automatic step at all - not marked, cut, restored or linked.
    accounts = [a for a in accounts if not a.get("on_hold")]
    link = [a for a in accounts if not a.get("linked") and a["provider_uid"] in logins]
    pool = [a for a in accounts if a.get("linked") and not a.get("protected") and not a.get("in_app_deletion")]
    gone = [a for a in pool if logins.get(a["provider_uid"], True)]       # absent, or present but disabled
    result = {"abort": None, "review": None, "missing": sorted(a["user_id"] for a in gone),
              "mark": [], "verify": [], "recover": [], "link": link}

    if not logins:
        result["abort"], result["link"] = "the login listing is empty", []
        return result
    threshold = max(limits.abnormal_abs, int(len(pool) * limits.abnormal_fraction))
    if len(gone) > threshold:
        result["abort"] = (f"{len(gone)} of {len(pool)} accounts have no usable login in this listing "
                           f"(abnormal-drop guard {threshold}); nothing marked, cut or restored")
        result["link"] = []
        return result

    gone_ids = {a["user_id"] for a in gone}
    result["mark"] = [a for a in gone if not a.get("ledger_status")]
    result["recover"] = [a for a in pool if a.get("ledger_status") and a["user_id"] not in gone_ids]

    cutoff = now - timedelta(seconds=limits.grace_seconds)
    due = [a for a in gone if a.get("ledger_status") == "observed_missing" and _ts(a["first_missing_at"]) <= cutoff]
    if len(due) > limits.max_suspend:
        result["review"] = (f"{len(due)} accounts are due to be cut off, above the ceiling of "
                            f"{limits.max_suspend}; none cut - an admin must review")
    else:
        result["verify"] = due
    return result


def _ts(value) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
