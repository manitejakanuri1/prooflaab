"""ProofLab code runner: POST /run {language, code, stdin} -> {status, stdout, stderr}.

status is one of ok | compile_error | runtime_error | time_limit, the same
shape supabase/functions/_shared/sandbox.ts already grades.

Isolation (hardened 3 Oct 2026 after staging probes proved F8/F9):
  * one run at a time per instance (Cloud Run concurrency 1, and a lock here);
  * every run is a fresh uid-'runner' session with CPU, file-size, process and
    (per language) memory limits;
  * output goes to capped files, not pipes, so a background child holding a
    pipe can no longer hang the request (it did: 120 s on staging);
  * after EVERY run - success, error, timeout - every process owned by 'runner'
    is killed and runner-owned files in the shared temp dirs are removed, so
    nothing survives into the next student's run (F8);
  * where the platform allows it, each run gets its own empty network namespace:
    no internet, no metadata server (F9). /ready reports whether it is active.
"""
import base64
import ctypes
import threading
import time
import hmac
import json
import math
import os
import pwd
import re
import resource
import shutil
import signal
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("RUNNER_SECRET", "")
# G12: service identity instead of a shared secret. With RUNNER_ALLOWED_CALLERS set, the caller
# must be one of these Google service accounts. Cloud Run IAM has ALREADY verified the identity
# token's signature and audience before the request reaches this container (the service must be
# deployed without public access); this is the second lock, naming exactly who may run code.
ALLOWED_CALLERS = set(filter(None, os.environ.get("RUNNER_ALLOWED_CALLERS", "").split(",")))


def caller_email(auth_header: str) -> str:
    """The e-mail claim of a bearer identity token (signature already checked by Cloud Run)."""
    try:
        part = auth_header.split(" ", 1)[1].split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return claims.get("email", "") if claims.get("email_verified") is True else ""
    except Exception:
        return ""


def authorised(headers) -> bool:
    if ALLOWED_CALLERS:
        return caller_email(headers.get("Authorization", "")) in ALLOWED_CALLERS
    return bool(SECRET) and hmac.compare_digest(headers.get("x-runner-secret", ""), SECRET)
PORT = int(os.environ.get("PORT", "8080"))
RUNNER = pwd.getpwnam("runner")

COMPILE_SECONDS = 40

# Must match task_sandbox_config's legal range. The caller clamps first and the
# runner clamps again because the runner is the final security boundary.
DEFAULT_TIME_LIMIT_MS = 5000
MIN_TIME_LIMIT_MS = 500
MAX_TIME_LIMIT_MS = 20000

DEFAULT_MEMORY_LIMIT_MB = 256
MIN_MEMORY_LIMIT_MB = 32
MAX_MEMORY_LIMIT_MB = 1024

MAX_OUTPUT = 64 * 1024
MAX_CODE = 100 * 1024

# These runtimes tolerate a hard address-space ceiling. JVM/V8 reserve large
# virtual regions and Go manages its heap differently, so those use native
# runtime controls below instead of RLIMIT_AS.
AS_LIMIT_LANGUAGES = {"python", "ruby", "php", "c", "cpp"}
SHARED_TMP = ("/tmp", "/var/tmp", "/dev/shm")
RUN_LOCK = threading.Lock()

CLONE_NEWNET = 0x40000000
_libc = ctypes.CDLL(None, use_errno=True)


def clamp_int(value, default: int, low: int, high: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return max(low, min(high, n))


def _probe_net_isolation() -> bool:
    """Can a child process be given its own (empty) network namespace here?"""
    pid = os.fork()
    if pid == 0:
        os._exit(0 if _libc.unshare(CLONE_NEWNET) == 0 else 1)
    _, status = os.waitpid(pid, 0)
    return os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0


NET_ISOLATION = _probe_net_isolation()


def java_main_class(code: str) -> str:
    """The class that declares main - the one to run. Falls back to the first class."""
    main_at = re.search(r"static\s+void\s+main\s*\(", code)
    classes = list(re.finditer(r"\bclass\s+([A-Za-z_]\w*)", code))
    if not classes:
        return "Main"
    if main_at:
        before = [c for c in classes if c.start() < main_at.start()]
        if before:
            return before[-1].group(1)
    return classes[0].group(1)


def java_file_name(code: str) -> str:
    """javac insists a public class lives in a file of the same name."""
    public = re.search(r"\bpublic\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)", code)
    return f"{public.group(1) if public else java_main_class(code)}.java"


def plan(language: str, code: str, memory_mb: int):
    """(source file name, compile command or None, run command), or None if unsupported."""
    if language == "python":
        return "main.py", None, ["python3", "main.py"]
    if language == "javascript":
        return "main.js", None, ["node", f"--max-old-space-size={memory_mb}", "main.js"]
    if language == "ruby":
        return "main.rb", None, ["ruby", "main.rb"]
    if language == "php":
        return "main.php", None, ["php", "main.php"]
    if language == "c":
        return "main.c", ["gcc", "-O2", "-o", "main", "main.c", "-lm"], ["./main"]
    if language == "cpp":
        return "main.cpp", ["g++", "-O2", "-std=c++17", "-o", "main", "main.cpp"], ["./main"]
    if language == "go":
        return "main.go", ["go", "build", "-o", "main", "main.go"], ["./main"]
    if language == "java":
        name = java_file_name(code)
        return name, ["javac", "-J-Xmx512m", name], ["java", f"-Xmx{memory_mb}m", "-Xss1m", "-cp", ".", java_main_class(code)]
    return None


def limits(cpu_seconds: int, memory_mb: int | None):
    def apply():
        os.setsid()
        if NET_ISOLATION and _libc.unshare(CLONE_NEWNET) != 0:
            raise OSError("network isolation failed")  # refuse to run with network
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if memory_mb:
            resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        os.setgid(RUNNER.pw_gid)
        os.setuid(RUNNER.pw_uid)
    return apply


def kill_runner_processes() -> int:
    """SIGKILL every process owned by 'runner'. Safe: only one run exists per instance."""
    killed = 0
    for _ in range(5):
        found = False
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            try:
                if os.stat(f"/proc/{entry}").st_uid == RUNNER.pw_uid:
                    os.kill(int(entry), signal.SIGKILL)
                    found = True
                    killed += 1
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
        if not found:
            break
        time.sleep(0.05)
    return killed


def clean_shared_tmp() -> None:
    """Remove anything 'runner' left in the shared temp dirs (e.g. /tmp marker files)."""
    for base in SHARED_TMP:
        try:
            names = os.listdir(base)
        except OSError:
            continue
        for name in names:
            path = os.path.join(base, name)
            try:
                if os.lstat(path).st_uid != RUNNER.pw_uid:
                    continue
                if os.path.isdir(path) and not os.path.islink(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.unlink(path)
            except OSError:
                pass


def execute(cmd, cwd, stdin, seconds: float, memory_mb=None, env_overrides=None):
    """(exit code, or None when stopped for time; stdout; stderr).

    Output goes to files in a root-only directory, capped by RLIMIT_FSIZE, and
    only the first MAX_OUTPUT bytes are read back. With pipes, a child that kept
    stdout open made communicate() wait forever.
    """
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": cwd, "TMPDIR": cwd, "GOCACHE": f"{cwd}/.gocache",
           "GOPATH": f"{cwd}/.gopath", "LANG": "C.UTF-8", "GO111MODULE": "off", "GOMEMLIMIT": "512MiB"}
    if env_overrides:
        env.update(env_overrides)
    cpu_seconds = max(1, math.ceil(seconds))
    io_dir = tempfile.mkdtemp(prefix="io-")          # root-owned, 0700: the program cannot reach it
    try:
        out_path, err_path, in_path = (os.path.join(io_dir, n) for n in ("out", "err", "in"))
        with open(in_path, "wb") as fh:
            fh.write(stdin.encode())
        with open(in_path, "rb") as fin, open(out_path, "wb") as fout, open(err_path, "wb") as ferr:
            proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=fin, stdout=fout, stderr=ferr,
                                    preexec_fn=limits(cpu_seconds, memory_mb))
            try:
                code = proc.wait(timeout=seconds)
                # A CPU-limit kill arrives as a signal, not as a timeout.
                if code in (-signal.SIGXCPU, -signal.SIGKILL):
                    code = None
            except subprocess.TimeoutExpired:
                code = None
            finally:
                kill_runner_processes()                 # the program AND anything it left behind
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass

        def read(path):
            with open(path, "rb") as fh:
                return fh.read(MAX_OUTPUT).decode("utf-8", "replace")
        return code, read(out_path), read(err_path)
    finally:
        shutil.rmtree(io_dir, ignore_errors=True)


def run(
    language: str,
    code: str,
    stdin: str,
    time_limit_ms: int = DEFAULT_TIME_LIMIT_MS,
    memory_limit_mb: int = DEFAULT_MEMORY_LIMIT_MB,
) -> dict:
    steps = plan(language, code, memory_limit_mb)
    if steps is None:
        return {"status": "compile_error", "stdout": "", "stderr": f"Unsupported language: {language}"}
    filename, compile_cmd, run_cmd = steps
    work = tempfile.mkdtemp(prefix="run-")
    try:
        path = os.path.join(work, filename)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(code)
        os.chown(work, RUNNER.pw_uid, RUNNER.pw_gid)
        os.chown(path, RUNNER.pw_uid, RUNNER.pw_gid)

        # Compilation has its own infrastructure ceiling. A task's time limit
        # measures execution, not gcc/javac/go compiler startup.
        if compile_cmd:
            c, out, err = execute(compile_cmd, work, "", COMPILE_SECONDS)
            if c != 0:
                return {"status": "compile_error", "stdout": "",
                        "stderr": (err or out or "compilation took too long").strip()}

        execution_seconds = time_limit_ms / 1000.0
        address_space_mb = memory_limit_mb if language in AS_LIMIT_LANGUAGES else None
        env_overrides = {"GOMEMLIMIT": f"{memory_limit_mb}MiB"} if language == "go" else None

        c, out, err = execute(
            run_cmd,
            work,
            stdin,
            execution_seconds,
            address_space_mb,
            env_overrides,
        )
        if c is None:
            return {"status": "time_limit", "stdout": out, "stderr": err}
        return {"status": "ok" if c == 0 else "runtime_error", "stdout": out, "stderr": err}
    finally:
        kill_runner_processes()
        shutil.rmtree(work, ignore_errors=True)
        clean_shared_tmp()


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        ok = self.path == "/ready"
        self.reply(200 if ok else 404, {"ok": ok, "net_isolation": NET_ISOLATION} if ok else {"ok": False})

    def do_POST(self):
        if self.path != "/run":
            return self.reply(404, {"error": "not found"})
        if not authorised(self.headers):
            return self.reply(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_CODE * 2:
            return self.reply(413, {"error": "too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            language = str(body.get("language", "")).lower()
            code = str(body.get("code", ""))
            stdin = str(body.get("stdin", ""))
            time_limit_ms = clamp_int(
                body.get("time_limit_ms"),
                DEFAULT_TIME_LIMIT_MS,
                MIN_TIME_LIMIT_MS,
                MAX_TIME_LIMIT_MS,
            )
            memory_limit_mb = clamp_int(
                body.get("memory_limit_mb"),
                DEFAULT_MEMORY_LIMIT_MB,
                MIN_MEMORY_LIMIT_MB,
                MAX_MEMORY_LIMIT_MB,
            )
        except (ValueError, TypeError):
            return self.reply(400, {"error": "bad json"})
        if not code or len(code) > MAX_CODE:
            return self.reply(400, {"error": "code missing or too long"})
        with RUN_LOCK:                                  # one run per instance, always
            try:
                result = run(language, code, stdin, time_limit_ms, memory_limit_mb)
            except (OSError, subprocess.SubprocessError) as e:
                print(f"RUNNER INFRA ERROR: {e}", flush=True)
                return self.reply(503, {"error": "runner could not start the program"})
        self.reply(200, result)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
