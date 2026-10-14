"""python accounts/test_self_delete.py - exits non-zero on failure. No network: identity and db are stand-ins."""
import self_delete

ME, UID = "11111111-1111-1111-1111-111111111111", "google-uid-1"


class World:
    """Records every call; `fail` names the steps that fail and how many times."""

    def __init__(self, fail=None, mapping=True, already_gone=False):
        self.fail = dict(fail or {})
        self.calls, self.disabled, self.data, self.login, self.marked = [], False, True, True, False
        self.mapping, self.already_gone = mapping, already_gone
        self.attempts = 0

    def _fails(self, step):
        if self.fail.get(step, 0) > 0:
            self.fail[step] -= 1
            return True
        return False

    def identity(self, path, body):
        self.calls.append(path + (":" + str(body.get("disableUser")) if "disableUser" in body else ""))
        if path == "accounts:update":
            step = "disable" if body["disableUser"] else "enable"
            if self._fails(step):
                return 500, {}
            self.disabled = body["disableUser"]
            return 200, {}
        if self._fails("delete"):
            raise TimeoutError("identity timed out")
        if self.already_gone:
            return 400, {"error": {"message": "USER_NOT_FOUND"}}
        self.login = False
        return 200, {}

    def db(self, path, body=None, method="POST"):
        self.calls.append(path.split("?")[0])
        if path.startswith("account_identities"):
            return 200, ([{"provider_uid": UID}] if self.mapping else [])
        if path == "rpc/remove_students":
            assert body == {"_ids": [ME], "_by": ME, "_reason": "self"}, body
            if self._fails("rpc"):
                return 500, {"message": "boom"}
            if self._fails("rpc-timeout-after-commit"):
                self.data = False
                raise TimeoutError("database answer lost")
            self.data = False
            return 200, [{"student_id": ME, "provider_uid": UID, "email": "x"}]
        if method == "PATCH":
            assert "reason=eq.self" in path and "login_deleted_at=is.null" in path
            if "login_deleted_at" in body:
                assert list(body) == ["login_deleted_at"], "the service may write only this column"
                self.marked = True
            else:
                self.attempts += body["login_delete_attempts"]
            return 204, None
        if method == "GET" and "select=id" in path:  # did the delete happen after all?
            return 200, ([] if self.data else [{"id": "r1"}])
        if method == "GET":  # retry listing: least-tried first, a small batch
            assert "order=login_delete_attempts.asc,removed_at.asc" in path and "limit=10" in path, path
            return 200, [{"student_id": ME, "snapshot": {"provider_uid": UID}, "login_delete_attempts": 0}]
        raise AssertionError(path)


def run(world):
    return self_delete.run(ME, world.identity, world.db, lambda seconds: None)


# Everything works: disabled first, then data, then login, then recorded.
w = World()
assert run(w) == (200, {"removed": 1, "login_deleted": True})
assert w.calls == ["account_identities", "accounts:update:True", "rpc/remove_students", "accounts:delete", "removed_students"], w.calls
assert not w.data and not w.login and w.marked

# No login mapping: nothing is touched.
w = World(mapping=False)
status, body = run(w)
assert status == 500 and "Nothing was changed" in body["error"] and w.data and w.login and not w.disabled

# The login cannot be disabled: nothing is deleted.
w = World(fail={"disable": 1})
status, body = run(w)
assert status == 502 and w.data and w.login and "rpc/remove_students" not in w.calls

# The database refuses: the login is enabled again and nothing is deleted.
w = World(fail={"rpc": 1})
status, body = run(w)
assert status == 500 and "Nothing was changed" in body["error"] and w.data and w.login and not w.disabled

# The database refuses AND the login cannot be re-enabled: said plainly, never "nothing changed".
w = World(fail={"rpc": 1, "enable": 1})
status, body = run(w)
assert status == 500 and "locked" in body["error"] and w.data and w.disabled

# The database deleted the data but its answer was lost: the login is deleted, never re-enabled.
w = World(fail={"rpc-timeout-after-commit": 1})
assert run(w) == (200, {"removed": 1, "login_deleted": True})
assert not w.data and not w.login and "accounts:update:False" not in w.calls

# The login delete fails twice then works: still a full success.
w = World(fail={"delete": 2})
assert run(w) == (200, {"removed": 1, "login_deleted": True}) and w.calls.count("accounts:delete") == 3 and w.marked

# The login delete fails every time: NOT reported as complete, login stays disabled, nothing is marked.
w = World(fail={"delete": 3})
assert run(w) == (200, {"removed": 1, "login_deleted": False})
assert not w.data and w.login and w.disabled and not w.marked

# A login that is already gone counts as deleted.
w = World(already_gone=True)
assert run(w) == (200, {"removed": 1, "login_deleted": True}) and w.marked

# The retry finishes a pending deletion and records it; a second failure leaves it pending.
w = World()
assert self_delete.retry_pending(w.identity, w.db) == {"pending": 0, "finished": 1, "needs_review": 0} and w.marked
w = World(fail={"delete": 3})
assert self_delete.retry_pending(w.identity, w.db) == {"pending": 1, "finished": 0, "needs_review": 0} and not w.marked
assert w.calls.count("accounts:delete") == 1 and w.attempts == 1, "one try a run, and the failure is counted"

print("self_delete: 11 cases passed")
