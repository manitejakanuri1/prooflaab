"""python accounts/test_lifecycle.py - exits non-zero on failure. No network: identity and db are stand-ins,
so no real Google login or database row can change."""
import lifecycle


class Google:
    """One login pool. `answers` overrides the reply for a path (a list is consumed in order)."""

    def __init__(self, users=None, answers=None):
        self.users = dict(users or {})          # uid -> disabled
        self.answers = {k: list(v) if isinstance(v, list) else v for k, v in (answers or {}).items()}
        self.calls = []

    def __call__(self, path, body):
        self.calls.append((path, body))
        a = self.answers.get(path)
        if isinstance(a, list) and a:
            a = a.pop(0)
        if isinstance(a, Exception):
            raise a
        if a is not None:
            return a
        uid = body["localId"][0] if isinstance(body.get("localId"), list) else body.get("localId")
        if path == "accounts:lookup":
            return 200, ({"users": [{"localId": uid, "disabled": self.users[uid]}]} if uid in self.users else {})
        if path == "accounts:delete":
            if uid not in self.users:
                return 400, {"error": {"message": "USER_NOT_FOUND"}}
            del self.users[uid]
            return 200, {}
        if path == "accounts:update":
            self.users[uid] = body["disableUser"]
            return 200, {}
        raise AssertionError(path)


class Db:
    def __init__(self, due=None, fail_record=False):
        self.due, self.results, self.fail_record = list(due or []), [], fail_record

    def __call__(self, path, body=None, method="POST", prefer=None):
        if path == "rpc/identity_due_deletions":
            assert body["_project"] == "proj" and body["_tenant"] == "", body   # scoped, always
            return 200, self.due
        if path == "rpc/identity_attempt_result":
            if self.fail_record:
                return 500, {}
            self.results.append((body["_id"], body["_deleted"], body["_error"]))
            return 200, "completed" if body["_deleted"] else "pending"
        raise AssertionError(path)


# lookup: every answer that is not a clear yes/no is "unknown", never "absent".
assert lifecycle.lookup(Google({"a": False}), "a") == "present"
assert lifecycle.lookup(Google({"a": True}), "a") == "disabled"
assert lifecycle.lookup(Google({}), "a") == "absent"
for bad in [(403, {}), (429, {}), (500, {}), (503, "x"), (400, {"error": {"message": "INVALID_ID_TOKEN"}})]:
    assert lifecycle.lookup(Google(answers={"accounts:lookup": bad}), "a") == "unknown", bad
assert lifecycle.lookup(Google(answers={"accounts:lookup": TimeoutError()}), "a") == "unknown"
# a lookup answer about ANOTHER id is not about this one
assert lifecycle.lookup(Google(answers={"accounts:lookup": (200, {"users": [{"localId": "b"}]})}), "a") == "absent"

# delete: confirmed by Google.
g = Google({"a": False})
assert lifecycle.delete_login(g, "a") == (True, None) and "a" not in g.users

# USER_NOT_FOUND counts only after the exact lookup agrees.
assert lifecycle.delete_login(Google({}), "a") == (True, None)
g = Google({"a": False}, answers={"accounts:delete": (400, {"error": {"message": "USER_NOT_FOUND"}})})
ok, err = lifecycle.delete_login(g, "a")
assert not ok and "present" in err, err
g = Google({}, answers={"accounts:lookup": (403, {})})
ok, err = lifecycle.delete_login(g, "a")
assert not ok and "unknown" in err, err

# Provider errors are failed tries, never success.
for bad in [(400, {"error": {"message": "INVALID_ARGUMENT"}}), (403, {}), (429, {}), (500, {}), (503, {})]:
    ok, err = lifecycle.delete_login(Google({"a": False}, answers={"accounts:delete": bad}), "a")
    assert not ok and err, bad
ok, err = lifecycle.delete_login(Google({"a": False}, answers={"accounts:delete": ConnectionResetError()}), "a")
assert not ok and "ConnectionResetError" in err

# disable
g = Google({"a": False})
assert lifecycle.disable_login(g, "a") and g.users["a"] is True
assert not lifecycle.disable_login(Google(answers={"accounts:update": (500, {})}), "a")

# process_due: each due row tried once; success and failure both recorded; one bad row does not block others.
g = Google({"a": False, "c": False}, answers={"accounts:delete": [(200, {}), (429, {}), (200, {})]})
d = Db(due=[{"id": 1, "provider_uid": "a"}, {"id": 2, "provider_uid": "b"}, {"id": 3, "provider_uid": "c"}])
out = lifecycle.process_due(g, d, "proj", "")
assert out == {"due": 3, "completed": 2, "pending": 1, "failed": 0}, out
assert [(i, ok) for i, ok, _ in d.results] == [(1, True), (2, False), (3, True)], d.results

# Same row run twice (duplicate scheduler fire): second run sees nothing due -> no Google call at all.
g = Google({"a": False})
out = lifecycle.process_due(g, Db(due=[]), "proj", "")
assert out["due"] == 0 and g.calls == [], out

# Outbox unreadable: nothing is tried.
class DownDb(Db):
    def __call__(self, path, body=None, method="POST", prefer=None):
        return 503, {}
g = Google({"a": False})
assert lifecycle.process_due(g, DownDb(), "proj", "")["due"] is None and g.calls == []

# A recorded result that cannot be saved is reported (None), and the login delete is not repeated here.
g = Google({"a": False})
assert lifecycle.attempt(g, Db(fail_record=True), {"id": 9, "provider_uid": "a"}) is None

print("lifecycle: all checks passed")
