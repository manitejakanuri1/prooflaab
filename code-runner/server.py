"""ProofLab code runner: POST /run {language, code, stdin} -> {status, stdout, stderr}.

status is one of ok | compile_error | runtime_error | time_limit, the same
shape supabase/functions/_shared/sandbox.ts already grades.
"""
import hmac
import json
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
PORT = int(os.environ.get("PORT", "8080"))
RUNNER = pwd.getpwnam("runner")

COMPILE_SECONDS = 40
RUN_SECONDS = 10
MAX_OUTPUT = 64 * 1024
MAX_CODE = 100 * 1024


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


def plan(language: str, code: str):
    """(source file name, compile command or None, run command), or None if unsupported."""
    if language == "python":
        return "main.py", None, ["python3", "main.py"]
    if language == "javascript":
        return "main.js", None, ["node", "main.js"]
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
        return name, ["javac", "-J-Xmx512m", name], ["java", "-Xmx256m", "-Xss64m", "-cp", ".", java_main_class(code)]
    return None


def limits(cpu_seconds: int):
    def apply():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.setgid(RUNNER.pw_gid)
        os.setuid(RUNNER.pw_uid)
    return apply


def execute(cmd, cwd, stdin, seconds):
    """(exit code, or None when stopped for time; stdout; stderr)."""
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": cwd, "GOCACHE": f"{cwd}/.gocache",
           "GOPATH": f"{cwd}/.gopath", "LANG": "C.UTF-8", "GO111MODULE": "off"}
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, preexec_fn=limits(seconds))
    try:
        out, err = proc.communicate(stdin.encode(), timeout=seconds)
        code = proc.returncode
        # A CPU-limit kill arrives as a signal, not as a timeout.
        if code in (-signal.SIGXCPU, -signal.SIGKILL):
            code = None
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
        code = None

    def cut(b):
        return b[:MAX_OUTPUT].decode("utf-8", "replace")
    return code, cut(out), cut(err)


def run(language: str, code: str, stdin: str) -> dict:
    steps = plan(language, code)
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
        if compile_cmd:
            c, out, err = execute(compile_cmd, work, "", COMPILE_SECONDS)
            if c != 0:
                return {"status": "compile_error", "stdout": "",
                        "stderr": (err or out or "compilation took too long").strip()}
        c, out, err = execute(run_cmd, work, stdin, RUN_SECONDS)
        if c is None:
            return {"status": "time_limit", "stdout": out, "stderr": err}
        return {"status": "ok" if c == 0 else "runtime_error", "stdout": out, "stderr": err}
    finally:
        shutil.rmtree(work, ignore_errors=True)


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
        self.reply(200 if ok else 404, {"ok": ok})

    def do_POST(self):
        if self.path != "/run":
            return self.reply(404, {"error": "not found"})
        if not SECRET or not hmac.compare_digest(self.headers.get("x-runner-secret", ""), SECRET):
            return self.reply(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_CODE * 2:
            return self.reply(413, {"error": "too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            language = str(body.get("language", "")).lower()
            code = str(body.get("code", ""))
            stdin = str(body.get("stdin", ""))
        except (ValueError, TypeError):
            return self.reply(400, {"error": "bad json"})
        if not code or len(code) > MAX_CODE:
            return self.reply(400, {"error": "code missing or too long"})
        self.reply(200, run(language, code, stdin))

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
