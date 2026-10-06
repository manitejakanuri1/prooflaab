"""Black-box tests for the ProofLab code runner. Never point this at production.

    RUNNER_URL=http://localhost:8080 RUNNER_SECRET=test python3 code-runner/test_runner.py
    (CI builds the image and runs it locally; staging: the staging URL + staging secret.)

Exits non-zero if any check fails. REQUIRE_NET_ISOLATION=1 makes network
isolation mandatory (staging/production must report it); a plain local Docker
container may not grant it, and then the network checks are reported as skipped.
"""
import json
import os
import sys
import time
import urllib.request

URL = os.environ["RUNNER_URL"].rstrip("/")
SECRET = os.environ.get("RUNNER_SECRET", "")
ID_TOKEN = os.environ.get("RUNNER_ID_TOKEN", "").strip()
failures: list[str] = []


def request_headers(extra: dict | None = None) -> dict:
    """Headers for either shared-secret or Cloud Run IAM mode."""
    headers = dict(extra or {})

    if ID_TOKEN:
        headers["Authorization"] = f"Bearer {ID_TOKEN}"

    return headers


def run(language: str, code: str, stdin: str = "", timeout: int = 90,
        time_limit_ms: int | None = None, memory_limit_mb: int | None = None) -> dict:
    payload = {"language": language, "code": code, "stdin": stdin}
    if time_limit_ms is not None:
        payload["time_limit_ms"] = time_limit_ms
    if memory_limit_mb is not None:
        payload["memory_limit_mb"] = memory_limit_mb
    req = urllib.request.Request(f"{URL}/run", method="POST",
                                 data=json.dumps(payload).encode(),
                                 headers=request_headers({
                                       "Content-Type": "application/json",
                                       "x-runner-secret": SECRET,
                                   }))
    started = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = json.load(r)
    out["seconds"] = round(time.time() - started, 1)
    return out


def check(name: str, cond: bool, detail="") -> None:
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {str(detail)[:300]}"))
    if not cond:
        failures.append(name)


ready_req = urllib.request.Request(
    f"{URL}/ready",
    headers=request_headers(),
)
ready = json.load(urllib.request.urlopen(ready_req, timeout=30))
net = bool(ready.get("net_isolation"))
print(f"ready: {ready}")
if os.environ.get("REQUIRE_NET_ISOLATION") == "1":
    check("network isolation active", net, ready)

# --- every language: stdin -> stdout ------------------------------------------------
HELLO = {
    "python": "print('hi ' + input())",
    "javascript": "const s=require('fs').readFileSync(0,'utf-8').trim(); console.log('hi ' + s)",
    "ruby": "puts 'hi ' + gets.strip",
    "php": "<?php echo 'hi ' . trim(fgets(STDIN)) . PHP_EOL;",
    "c": '#include <stdio.h>\nint main(){char b[64];scanf("%63s",b);printf("hi %s\\n",b);return 0;}',
    "cpp": '#include <iostream>\nint main(){std::string s;std::cin>>s;std::cout<<"hi "<<s<<std::endl;}',
    "go": 'package main\nimport "fmt"\nfunc main(){var s string;fmt.Scan(&s);fmt.Println("hi "+s)}',
    "java": 'import java.util.*;\nclass Solution{public static void main(String[] a){System.out.println("hi "+new Scanner(System.in).next());}}',
}
for lang, code in HELLO.items():
    r = run(lang, code, "dev")
    check(f"{lang}: stdin/stdout", r.get("status") == "ok" and r.get("stdout", "").strip() == "hi dev", r)

r = run("java", 'public class Main{public static void main(String[] a){System.out.println("pub");}}')
check("java: public class file naming", r.get("stdout", "").strip() == "pub", r)

# --- failure classes -----------------------------------------------------------------
r = run("cpp", "int main( {")
check("compile error classified", r.get("status") == "compile_error", r)
r = run("python", "raise SystemExit(3)")
check("runtime error classified", r.get("status") == "runtime_error", r)
r = run("python", "while True: pass")
check("infinite loop -> time_limit within ~15 s", r.get("status") == "time_limit" and r["seconds"] < 30, r)

r = run("python", "import time\ntime.sleep(2)", time_limit_ms=500)
check("C4: per-task 500 ms execution limit enforced",
      r.get("status") == "time_limit" and r["seconds"] < 5, r)

r = run("python", "x=bytearray(256*1024*1024)\nprint('allocated')", memory_limit_mb=128)
check("C4: per-task python memory limit enforced",
      "allocated" not in r.get("stdout", "") and r.get("status") != "ok", r)
r = run("python", "import sys\nwhile True: sys.stdout.write('x'*65536)")
check("huge output capped at 64 KB, request returns", len(r.get("stdout", "")) <= 64 * 1024 and r["seconds"] < 30, r.get("status"))
r = run("python", "print(9)")
check("unsupported-language guard does not block python", r.get("stdout", "").strip() == "9", r)
r = run("typescript", "console.log(1)")
check("unsupported language -> compile_error", r.get("status") == "compile_error", r)

# --- F8: nothing survives into the next run --------------------------------------------
r = run("python", "import subprocess\nsubprocess.Popen(['sh','-c','while true; do date +%s > /tmp/f8_marker; sleep 1; done'],"
                  "start_new_session=True)\nprint('spawned')")
check("background child with open stdout does not hang the run", r.get("status") == "ok" and r["seconds"] < 20, r)
r = run("python", "import os,time\ntime.sleep(2)\nprint('ALIVE' if os.path.exists('/tmp/f8_marker') else 'GONE')\n"
                  "import subprocess\nprint(subprocess.run(['sh','-c','ps -eo user= | grep -c ^runner'],capture_output=True,text=True).stdout.strip())")
lines = r.get("stdout", "").split()
check("F8: leftover process killed and its /tmp file removed", lines[:1] == ["GONE"], r)

# --- F9: memory, network, metadata -----------------------------------------------------
r = run("python", "x = bytearray(1500*1024*1024)\nprint('allocated')")
check("F9: 1.5 GB allocation refused (python)", "allocated" not in r.get("stdout", "") and r.get("status") != "ok", r)
r = run("javascript", "const a=[];while(true){a.push(new Array(1e6).fill(1))}")
check("F9: node heap capped", r.get("status") in ("runtime_error", "time_limit"), r)
NET = ("import urllib.request\n"
       "for u,h in [('https://example.com',{}),('http://metadata.google.internal/computeMetadata/v1/instance/id',{'Metadata-Flavor':'Google'})]:\n"
       "  try:\n    urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=4); print('OPEN')\n"
       "  except Exception as e: print('BLOCKED')")
r = run("python", NET)
if net:
    check("F9: internet and metadata unreachable", r.get("stdout", "").split() == ["BLOCKED", "BLOCKED"], r)
else:
    print(f"SKIP network checks (no net isolation on this host): {r.get('stdout', '').split()}")

# --- secret ---------------------------------------------------------------------------
if ID_TOKEN:
    # Cloud Run IAM mode: the relevant negative test is a request with
    # no bearer identity at all. A shared-secret header must not bypass IAM.
    try:
        unauth_req = urllib.request.Request(
            f"{URL}/run",
            method="POST",
            data=json.dumps({
                "language": "python",
                "code": "print(1)",
                "stdin": "",
            }).encode(),
            headers={
                "Content-Type": "application/json",
                "x-runner-secret": "wrong",
            },
        )
        urllib.request.urlopen(unauth_req, timeout=30)
        check("unauthenticated caller refused", False, "200")
    except urllib.error.HTTPError as e:
        check(
            "unauthenticated caller refused",
            e.code in (401, 403),
            e.code,
        )
else:
    try:
        urllib.request.urlopen(urllib.request.Request(f"{URL}/run", method="POST", data=b"{}",
                                                      headers={"x-runner-secret": "wrong"}), timeout=30)
        check("wrong secret refused", False, "200")
    except urllib.error.HTTPError as e:
        check("wrong secret refused", e.code == 401, e.code)


# C2-B1-A2-TESTS
import urllib.error


def c2_post(payload: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        f"{URL}/run",
        method="POST",
        data=json.dumps(payload).encode(),
        headers=request_headers({
            "Content-Type": "application/json",
            "x-runner-secret": SECRET,
        }),
    )

    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


# Explicit Java entrypoint must win over a student's own main().
java_student_main = """
class StudentMain {
    public static void main(String[] args) {
        System.out.println("STUDENT-MAIN");
    }
}

class __ProofLabMain {
    public static void main(String[] args) {
        System.out.println("TRUSTED-MAIN");
    }
}
"""

result = c2_post({
    "language": "java",
    "code": java_student_main,
    "stdin": "",
    "entrypoint": "__ProofLabMain",
    "time_limit_ms": 5000,
    "memory_limit_mb": 256,
})

check(
    "C2 explicit Java entrypoint overrides student main",
    result.get("status") == "ok"
    and result.get("stdout", "").strip() == "TRUSTED-MAIN",
    result,
)


# A misleading comment must not influence execution.
java_comment_main = """
// static void main( must not become the runner entry point.
class Solution {}

class __ProofLabMain {
    public static void main(String[] args) {
        System.out.println("COMMENT-SAFE");
    }
}
"""

result = c2_post({
    "language": "java",
    "code": java_comment_main,
    "stdin": "",
    "entrypoint": "__ProofLabMain",
    "time_limit_ms": 5000,
    "memory_limit_mb": 256,
})

check(
    "C2 explicit Java entrypoint ignores commented main",
    result.get("status") == "ok"
    and result.get("stdout", "").strip() == "COMMENT-SAFE",
    result,
)


# Bad entrypoint must fail closed.
try:
    c2_post({
        "language": "java",
        "code": "class Main {}",
        "stdin": "",
        "entrypoint": "bad-entrypoint!",
    })

    check(
        "C2 invalid Java entrypoint refused",
        False,
        "request unexpectedly succeeded",
    )

except urllib.error.HTTPError as exc:
    try:
        error_body = json.load(exc)
    except Exception:
        error_body = {}

    check(
        "C2 invalid Java entrypoint refused",
        exc.code == 400
        and error_body.get("error") == "invalid java entrypoint",
        {
            "status": exc.code,
            "body": error_body,
        },
    )


# Runner must tell the caller when stdout was clipped.
result = c2_post({
    "language": "python",
    "code": "print('x' * 70000)",
    "stdin": "",
})

check(
    "C2 stdout truncation flag",
    result.get("status") == "ok"
    and result.get("stdout_truncated") is True
    and len(result.get("stdout", "")) <= 64 * 1024,
    result.get("status"),
)


# Same guarantee for stderr.
result = c2_post({
    "language": "python",
    "code": "import sys; sys.stderr.write('x' * 70000)",
    "stdin": "",
})

check(
    "C2 stderr truncation flag",
    result.get("status") == "ok"
    and result.get("stderr_truncated") is True
    and len(result.get("stderr", "")) <= 64 * 1024,
    result.get("status"),
)


print(f"\n{len(failures)} failure(s)" + (": " + ", ".join(failures) if failures else ""))
sys.exit(1 if failures else 0)
