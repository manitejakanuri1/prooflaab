"""python accounts/test_removal_reason.py - exits non-zero on failure."""
import os

os.environ.setdefault("POSTGREST_URL", "http://localhost")
os.environ.setdefault("GOOGLE_API_KEY", "test")

from server import removal_reason  # noqa: E402

ME, OTHER = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"

# A student may delete only their own account, and only with the typed confirmation.
assert removal_reason("student", ME, [ME], "DELETE") == "self"
assert removal_reason("student", ME, [ME], None) is None
assert removal_reason("student", ME, [ME], "delete") is None
assert removal_reason("student", ME, [OTHER], "DELETE") is None
assert removal_reason("student", ME, [ME, OTHER], "DELETE") is None

# Colleges and administrators are unchanged; nobody else may remove anyone.
assert removal_reason("college_admin", ME, [OTHER], None) == "college"
assert removal_reason("admin", ME, [OTHER], None) == "admin"
assert removal_reason("startup", ME, [ME], "DELETE") is None
assert removal_reason(None, ME, [ME], "DELETE") is None

print("removal_reason: 9 checks passed")
