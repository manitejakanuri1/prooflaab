"""A student deletes their own account (migration 105). No network code here: the
caller passes `identity` and `db`, so the order of steps can be tested.

The order is what makes a failure safe at every point:

  1. Find the Google login.            Fails -> nothing changed.
  2. DISABLE the login.                Fails -> nothing changed.
  3. Delete the ProofLab data.         Fails -> the login is enabled again; nothing changed.
                                       (Unclear answer -> the removed_students record decides.)
  4. DELETE the login, up to 3 tries.  Fails -> the data is gone and the login stays DISABLED,
                                       so it cannot be used. The removed_students row keeps
                                       login_deleted_at empty and retry_pending() finishes it
                                       on a later sync run.

The answer always says which of the two happened: login_deleted true or false.
"""
import json
from datetime import datetime, timezone

ATTEMPTS = 3
NOTHING_CHANGED = "Your account was not deleted. Nothing was changed. Please try again."


def _gone(status: int, out) -> bool:
    """Deleted now, or already absent. Both mean no login is left."""
    return status == 200 or "USER_NOT_FOUND" in json.dumps(out)


def delete_login(identity, provider_uid: str, sleep) -> bool:
    for attempt in range(ATTEMPTS):
        try:
            status, out = identity("accounts:delete", {"localId": provider_uid})
            if _gone(status, out):
                return True
        except Exception as e:  # a timeout is one failed try, not a crash
            print("self-delete: login delete try failed:", type(e).__name__, flush=True)
        if attempt < ATTEMPTS - 1:
            sleep(2 ** attempt)
    return False


def mark_login_deleted(db, student_id: str) -> bool:
    status, _ = db(f"removed_students?student_id=eq.{student_id}&reason=eq.self&login_deleted_at=is.null",
                   {"login_deleted_at": datetime.now(timezone.utc).isoformat()}, method="PATCH")
    return status in (200, 204)


def run(who: str, identity, db, sleep):
    """Returns (http status, body)."""
    status, found = db(f"account_identities?select=provider_uid&user_id=eq.{who}", method="GET")
    if status != 200 or not isinstance(found, list) or len(found) != 1 or not found[0].get("provider_uid"):
        return 500, {"error": NOTHING_CHANGED}
    provider_uid = str(found[0]["provider_uid"])

    try:
        status, _ = identity("accounts:update", {"localId": provider_uid, "disableUser": True})
    except Exception:
        status = 0
    if status != 200:
        return 502, {"error": NOTHING_CHANGED}

    try:
        status, rows = db("rpc/remove_students", {"_ids": [who], "_by": who, "_reason": "self"})
        removed = status == 200 and isinstance(rows, list) and len(rows) == 1
    except Exception:
        removed = False
    if not removed:
        # A timeout can hide a delete that did happen. The record is the truth: if it exists the data is
        # gone and the login must go too; re-enabling it would leave a login with no account behind it.
        try:
            status, rec = db(f"removed_students?select=id&student_id=eq.{who}&reason=eq.self&login_deleted_at=is.null",
                             method="GET")
            removed = status == 200 and isinstance(rec, list) and len(rec) > 0
        except Exception:
            removed = False
    if not removed:
        try:
            undo, _ = identity("accounts:update", {"localId": provider_uid, "disableUser": False})
        except Exception:
            undo = 0
        if undo != 200:
            # Data intact, login disabled: an administrator must re-enable it. Loud, with no personal data.
            print(f"SELF DELETE NEEDS REVIEW: data kept but login left disabled for user {who}", flush=True)
            return 500, {"error": "Your account was not deleted, but your login is now locked. Please contact support."}
        return 500, {"error": NOTHING_CHANGED}

    login_deleted = delete_login(identity, provider_uid, sleep)
    if login_deleted and not mark_login_deleted(db, who):
        print(f"self-delete: login gone but not recorded for user {who}; the retry will record it", flush=True)
    if not login_deleted:
        print(f"SELF DELETE LOGIN PENDING: login disabled, deletion will be retried for user {who}", flush=True)
    return 200, {"removed": 1, "login_deleted": login_deleted}


def retry_pending(identity, db, sleep) -> dict:
    """Finish login deletions that failed earlier. Safe to run any number of times."""
    status, rows = db("removed_students?select=student_id,snapshot&reason=eq.self&login_deleted_at=is.null&limit=50",
                      method="GET")
    if status != 200 or not isinstance(rows, list):
        return {"pending": None, "finished": 0}
    finished = 0
    for row in rows:
        provider_uid = (row.get("snapshot") or {}).get("provider_uid")
        if provider_uid and delete_login(identity, str(provider_uid), sleep) and mark_login_deleted(db, row["student_id"]):
            finished += 1
    if len(rows) - finished:
        print(f"SELF DELETE LOGIN PENDING: {len(rows) - finished} login(s) still to delete", flush=True)
    return {"pending": len(rows) - finished, "finished": finished}
