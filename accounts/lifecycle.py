"""Google side of the identity lifecycle (migration 110). No network code here: the caller passes
`identity` (an Identity Platform call already bound to ONE project/tenant) and `db`, so every step is
testable with fakes and no test can reach a real account.

Rules this module enforces:
  * A login counts as deleted only when Google confirms the delete, or answers USER_NOT_FOUND AND an exact
    lookup of that same id in the same scope then finds nothing. Any other answer (400/403/429/5xx, timeout)
    is a failed try: the row stays pending, access stays cut, and the database schedules the next try with
    exponential backoff (identity_attempt_result).
  * Rows are only ever taken from identity_due_deletions(project, tenant), so a row recorded for another
    identity project or tenant is never acted on by this service.
"""
import json


def lookup(identity, provider_uid: str) -> str:
    """'present', 'disabled', 'absent' or 'unknown' (could not ask - never treated as absent)."""
    try:
        status, out = identity("accounts:lookup", {"localId": [provider_uid]})
    except Exception:
        return "unknown"
    if status != 200 or not isinstance(out, dict):
        return "unknown"
    users = [u for u in out.get("users") or [] if u.get("localId") == provider_uid]
    if not users:
        return "absent"
    return "disabled" if users[0].get("disabled") else "present"


def delete_login(identity, provider_uid: str) -> tuple[bool, str | None]:
    """(deleted, error). USER_NOT_FOUND is only accepted after an exact lookup agrees."""
    try:
        status, out = identity("accounts:delete", {"localId": provider_uid})
    except Exception as e:
        return False, f"delete: {type(e).__name__}"
    if status == 200:
        return True, None
    if "USER_NOT_FOUND" in json.dumps(out):
        seen = lookup(identity, provider_uid)
        return (True, None) if seen == "absent" else (False, f"USER_NOT_FOUND but lookup says {seen}")
    return False, f"delete: HTTP {status} {str(out)[:150]}"


def disable_login(identity, provider_uid: str) -> bool:
    try:
        status, _ = identity("accounts:update", {"localId": provider_uid, "disableUser": True})
    except Exception:
        return False
    return status == 200


def attempt(identity, db, row: dict) -> str | None:
    """One Google delete for one outbox row; returns the row's new status (or None if another run won)."""
    deleted, error = delete_login(identity, str(row["provider_uid"]))
    status, out = db("rpc/identity_attempt_result", {"_id": row["id"], "_deleted": deleted, "_error": error})
    if status != 200:
        print(f"IDENTITY LIFECYCLE RECORD FAILED: row {row['id']} deleted={deleted} db={status}", flush=True)
        return None
    if out == "failed":
        print(f"IDENTITY LIFECYCLE NEEDS REVIEW: row {row['id']} gave up after repeated failures", flush=True)
    return out


def process_due(identity, db, project: str, tenant: str, limit: int = 10) -> dict:
    """Retry every due deletion in this scope (one try each). Safe to run any number of times."""
    status, rows = db("rpc/identity_due_deletions", {"_project": project, "_tenant": tenant, "_limit": limit})
    if status != 200 or not isinstance(rows, list):
        print(f"IDENTITY LIFECYCLE RETRY FAILED: could not read the outbox ({status})", flush=True)
        return {"due": None, "completed": 0, "pending": 0, "failed": 0}
    counts = {"due": len(rows), "completed": 0, "pending": 0, "failed": 0}
    for row in rows:
        result = attempt(identity, db, row)
        if result in counts:
            counts[result] += 1
    return counts
