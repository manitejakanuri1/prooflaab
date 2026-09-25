"""Step 5 temporary worker: proves enqueue -> Cloud Tasks -> authenticated
Cloud Run worker -> processing, with nothing real behind it yet.

Not wired to any real business logic. No transcription, no DeepSeek, no
production data - staging-only smoke test for the queue foundation itself.
Delete this service once the pattern it proves has been copied into a real
worker, or once Step 5 is fully superseded.

Auth is NOT handled here - it never needs to be. Cloud Run's own IAM (this
service deployed --no-allow-unauthenticated, with roles/run.invoker granted
only to the dedicated task-invoker service account) rejects every
unauthenticated request before it reaches this process at all. A random
public POST gets Google's own 403, not a line of this file's code.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))

# In-memory only, on purpose: this is a foundation smoke test, not a real
# worker. A real worker's idempotency key belongs in a durable store (the
# staging DB, matching how the rest of this project already dedupes writes)
# so it survives a container restart - this just proves the pattern.
seen_tasks = set()


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200 if self.path == "/ready" else 404, {"ok": self.path == "/ready"})

    def do_POST(self):
        if self.path != "/work":
            return self.reply(404, {"error": "not found"})

        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self.reply(400, {"error": "bad json"})

        task_name = self.headers.get("X-Cloudtasks-Taskname", "")
        retry_count = self.headers.get("X-Cloudtasks-Taskretrycount", "0")
        queue_name = self.headers.get("X-Cloudtasks-Queuename", "")

        if task_name and task_name in seen_tasks:
            print(f"WORKER: duplicate delivery of task={task_name}, skipping reprocessing (idempotent)", flush=True)
            return self.reply(200, {"ok": True, "duplicate": True, "task": task_name})

        if body.get("forceFailUntilRetry") and retry_count == "0":
            print(f"WORKER: task={task_name} forced failure on first attempt (retry_count={retry_count})", flush=True)
            return self.reply(500, {"error": "forced failure for retry test"})

        if task_name:
            seen_tasks.add(task_name)
        print(f"WORKER: processed task={task_name} queue={queue_name} retry_count={retry_count} body={body}", flush=True)
        return self.reply(200, {"ok": True, "received": body})


if __name__ == "__main__":
    print(f"tasks-test-worker listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
