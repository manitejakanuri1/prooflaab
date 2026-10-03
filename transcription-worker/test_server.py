"""Tests for transcription-worker/server.py (not copied into the image).
Run: python -m unittest transcription-worker/test_server.py   (from the repo root)
or:  cd transcription-worker && python -m unittest test_server
Standard library only; every network call is replaced by a stub."""
import importlib
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BASE_ENV = {
    "PGRST_JWT_SECRET": "test-secret", "POSTGREST_URL": "https://prooflab-staging-api-x.a.run.app",
    "TRANSCRIBER_URL": "https://t", "FUNCTIONS_URL": "https://f", "PRIVATE_BUCKET": "b",
    "ENVIRONMENT": "staging",
}


def load(**env):
    with mock.patch.dict(os.environ, {**BASE_ENV, **env}, clear=True):
        import server
        return importlib.reload(server)


VID = "11111111-1111-1111-1111-111111111111"
JOB = [{"id": VID, "storage_path": "s/a.webm", "lease_token": "L1", "attempts": 1}]


class Worker(unittest.TestCase):
    def setUp(self):
        self.s = load()
        self.rpc_calls = []
        self.scoring_calls = []
        self.s.fetch_audio = lambda p: (b"audio", "audio/webm")
        self.s.transcribe = lambda a, c: {"text": "one two three", "segments": []}
        self.s.request_scoring = lambda v: self.scoring_calls.append(v) or "HTTP 200 {'success': True}"

    def rpc(self, answers):
        """answers: rpc name -> (status, body) or a list of them in call order."""
        def fake(name, args):
            self.rpc_calls.append((name, args))
            a = answers[name]
            return a.pop(0) if isinstance(a, list) else a
        self.s.db_rpc = fake

    def run_job(self, retry=0):
        out = io.StringIO()
        with redirect_stdout(out):
            code, body = self.s.process_job(VID, "task-1", retry)
        return code, body, out.getvalue()

    def names(self):
        return [n for n, _ in self.rpc_calls]

    # --- English-only gate (migration 69) ---
    META = {"language": "te", "language_probability": 0.97, "english_probability": 0.01, "gate": "non_english", "model": "base"}

    def test_non_english_is_closed_without_transcript_or_scoring(self):
        self.s.transcribe = lambda a, c: {"text": "", "segments": [], "non_english": True, "language_meta": self.META}
        self.rpc({"claim_transcription_job": (200, JOB), "set_transcription_language": (200, True)})
        code, body, log = self.run_job()
        self.assertEqual(code, 200)                       # not a retry case
        self.assertTrue(body["non_english"])
        self.assertEqual(self.names(), ["claim_transcription_job", "set_transcription_language"])
        self.assertTrue(dict(self.rpc_calls)["set_transcription_language"]["_reject"])
        self.assertEqual(self.scoring_calls, [])          # never scored
        self.assertNotIn("complete_transcription_job", self.names())
        self.assertIn("non-English", log)

    def test_english_recording_stores_what_was_heard_then_completes(self):
        meta = {**self.META, "language": "en", "gate": "english"}
        self.s.transcribe = lambda a, c: {"text": "one two three", "segments": [], "non_english": False, "language_meta": meta}
        self.rpc({"claim_transcription_job": (200, JOB), "set_transcription_language": (200, True),
                  "complete_transcription_job": (200, True)})
        code, body, _ = self.run_job()
        self.assertEqual(code, 200)
        self.assertFalse(dict(self.rpc_calls)["set_transcription_language"]["_reject"])
        self.assertEqual(self.names()[-1], "complete_transcription_job")
        self.assertEqual(self.scoring_calls, [VID])

    def test_metadata_save_failure_does_not_lose_an_english_recording(self):
        meta = {**self.META, "language": "en", "gate": "english"}
        self.s.transcribe = lambda a, c: {"text": "one two three", "segments": [], "non_english": False, "language_meta": meta}
        self.rpc({"claim_transcription_job": (200, JOB), "set_transcription_language": (500, None),
                  "complete_transcription_job": (200, True)})
        code, _, log = self.run_job()
        self.assertEqual(code, 200)
        self.assertEqual(self.scoring_calls, [VID])
        self.assertIn("language metadata not saved", log)

    def test_non_english_decision_not_saved_is_retried(self):
        self.s.transcribe = lambda a, c: {"text": "", "segments": [], "non_english": True, "language_meta": self.META}
        self.rpc({"claim_transcription_job": (200, JOB), "set_transcription_language": (500, None),
                  "fail_transcription_job": (200, True)})
        code, _, _ = self.run_job()
        self.assertEqual(code, 500)
        self.assertEqual(self.scoring_calls, [])

    def test_unreadable_recording_is_closed_at_once_not_retried_for_minutes(self):
        def unreadable(a, c):
            raise self.s.urllib.error.HTTPError("u", 422, "Unprocessable", {}, None)
        self.s.transcribe = unreadable
        self.rpc({"claim_transcription_job": (200, JOB), "fail_transcription_job": (200, True)})
        self.run_job(retry=0)
        self.assertTrue(dict(self.rpc_calls)["fail_transcription_job"]["_terminal"])

    def test_no_instance_available_is_still_retried(self):
        def busy(a, c):
            raise self.s.urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)
        self.s.transcribe = busy
        self.rpc({"claim_transcription_job": (200, JOB), "fail_transcription_job": (200, True)})
        self.run_job(retry=0)
        self.assertFalse(dict(self.rpc_calls)["fail_transcription_job"]["_terminal"])

    # --- successful completion ---
    def test_success_saves_then_requests_scoring(self):
        self.rpc({"claim_transcription_job": (200, JOB), "complete_transcription_job": (200, True)})
        code, body, log = self.run_job()
        self.assertEqual(code, 200)
        self.assertEqual(body["words"], 3)
        self.assertEqual(self.scoring_calls, [VID])
        self.assertIn("completed", log)

    # --- stale lease: a genuine false ---
    def test_stale_lease_is_acknowledged_but_not_completed_and_not_scored(self):
        self.rpc({"claim_transcription_job": (200, JOB), "complete_transcription_job": (200, False)})
        code, body, log = self.run_job()
        self.assertEqual(code, 200)
        self.assertTrue(body.get("stale_lease"))
        self.assertEqual(self.scoring_calls, [])
        self.assertNotIn("fail_transcription_job", self.names())
        self.assertNotIn("WORKER: completed", log)

    # --- HTTP 500 / unreachable / malformed from complete ---
    def _complete_not_confirmed(self, complete_answer):
        self.rpc({"claim_transcription_job": (200, JOB), "complete_transcription_job": complete_answer,
                  "fail_transcription_job": (200, True)})
        code, body, log = self.run_job()
        self.assertEqual(code, 500, "a failed/unknown save must never be acknowledged")
        self.assertEqual(self.scoring_calls, [])
        self.assertIn("fail_transcription_job", self.names())
        fail_args = dict(self.rpc_calls)["fail_transcription_job"]
        self.assertFalse(fail_args["_terminal"], "release as retryable, not terminal")
        self.assertEqual(fail_args["_lease_token"], "L1")
        self.assertIn("complete_transcription_job FAILED", log)
        return body

    def test_complete_http_500(self):
        self._complete_not_confirmed((500, None))

    def test_complete_unreachable(self):
        self._complete_not_confirmed((None, "timed out"))

    def test_complete_malformed_json(self):
        self._complete_not_confirmed((200, self.s.MALFORMED))

    def test_complete_wrong_type(self):
        for bad in ({"ok": True}, "true", 1, None, [True]):
            with self.subTest(bad=bad):
                self.setUp()
                self._complete_not_confirmed((200, bad))

    # --- claim errors ---
    def test_claim_http_error_is_not_acknowledged(self):
        self.rpc({"claim_transcription_job": (503, None)})
        code, _, _ = self.run_job()
        self.assertEqual(code, 500)

    def test_claim_malformed_is_not_acknowledged(self):
        self.rpc({"claim_transcription_job": (200, self.s.MALFORMED)})
        code, _, _ = self.run_job()
        self.assertEqual(code, 500)

    def test_nothing_to_claim_is_acknowledged(self):
        self.rpc({"claim_transcription_job": (200, [])})
        code, body, _ = self.run_job()
        self.assertEqual(code, 200)
        self.assertTrue(body["skipped"])

    # --- failed scoring request ---
    def test_failed_scoring_request_still_acknowledges_saved_job(self):
        self.s.request_scoring = lambda v: self.scoring_calls.append(v) or "unreachable (URLError)"
        self.rpc({"claim_transcription_job": (200, JOB), "complete_transcription_job": (200, True)})
        code, _, log = self.run_job()
        self.assertEqual(code, 200)
        self.assertIn("unreachable", log)

    # --- failed database-failure reporting ---
    def test_transcription_error_release_ok(self):
        self.s.transcribe = mock.Mock(side_effect=RuntimeError("whisper down"))
        self.rpc({"claim_transcription_job": (200, JOB), "fail_transcription_job": (200, True)})
        code, body, log = self.run_job(retry=0)
        self.assertEqual(code, 500)
        self.assertTrue(body["released"])
        self.assertFalse(dict(self.rpc_calls)["fail_transcription_job"]["_terminal"])

    def test_transcription_error_last_attempt_is_terminal(self):
        self.s.transcribe = mock.Mock(side_effect=RuntimeError("whisper down"))
        self.rpc({"claim_transcription_job": (200, JOB), "fail_transcription_job": (200, True)})
        self.run_job(retry=self.s.QUEUE_MAX_ATTEMPTS - 1)
        self.assertTrue(dict(self.rpc_calls)["fail_transcription_job"]["_terminal"])

    def test_fail_report_http_error_is_reported(self):
        self.s.transcribe = mock.Mock(side_effect=RuntimeError("whisper down"))
        self.rpc({"claim_transcription_job": (200, JOB), "fail_transcription_job": (500, None)})
        code, body, log = self.run_job()
        self.assertEqual(code, 500)
        self.assertFalse(body["released"])
        self.assertIn("FAIL-REPORT ERROR", log)

    def test_fail_report_malformed_is_reported(self):
        self.s.transcribe = mock.Mock(side_effect=RuntimeError("whisper down"))
        self.rpc({"claim_transcription_job": (200, JOB), "fail_transcription_job": (200, self.s.MALFORMED)})
        _, _, log = self.run_job()
        self.assertIn("FAIL-REPORT ERROR", log)

    def test_fail_report_stale_lease_is_not_an_error(self):
        self.s.transcribe = mock.Mock(side_effect=RuntimeError("whisper down"))
        self.rpc({"claim_transcription_job": (200, JOB), "fail_transcription_job": (200, False)})
        _, body, log = self.run_job()
        self.assertFalse(body["released"])
        self.assertIn("stale lease", log)
        self.assertNotIn("FAIL-REPORT ERROR", log)

    def test_complete_error_and_release_error_both_reported(self):
        self.rpc({"claim_transcription_job": (200, JOB), "complete_transcription_job": (500, None),
                  "fail_transcription_job": (None, "timed out")})
        code, body, log = self.run_job()
        self.assertEqual(code, 500)
        self.assertIn("complete_transcription_job FAILED", log)
        self.assertIn("FAIL-REPORT ERROR", log)


class ScoringLog(unittest.TestCase):
    def test_scoring_summary_never_contains_notes_or_score(self):
        s = load()
        body = b'{"success": true, "communication_score": 55, "notes": "You named the stack you used"}'

        class Resp:
            status = 200
            def read(self): return body
            def __enter__(self): return self
            def __exit__(self, *a): return False

        with mock.patch.object(s.urllib.request, "urlopen", return_value=Resp()):
            summary = s.request_scoring(VID)
        self.assertEqual(summary, "HTTP 200 {'success': True}")
        self.assertNotIn("named", summary)
        self.assertNotIn("55", summary)

    def test_scoring_unreachable_summary(self):
        s = load()
        with mock.patch.object(s.urllib.request, "urlopen", side_effect=OSError("down")):
            self.assertEqual(s.request_scoring(VID), "unreachable (OSError)")


class Config(unittest.TestCase):
    def test_valid_staging(self):
        self.assertEqual(load().check_config(), [])

    def test_valid_production(self):
        s = load(ENVIRONMENT="production", POSTGREST_URL="https://prooflab-api-x.a.run.app")
        self.assertEqual(s.check_config(), [])

    def test_missing_functions_url(self):
        self.assertIn("FUNCTIONS_URL is not set", load(FUNCTIONS_URL="").check_config())

    def test_every_required_setting(self):
        for k in BASE_ENV:
            with self.subTest(missing=k):
                self.assertTrue(any(k in p for p in load(**{k: ""}).check_config()))

    def test_fault_injection_refused_in_production(self):
        s = load(ENVIRONMENT="production", POSTGREST_URL="https://prooflab-api-x.a.run.app",
                 FAULT_INJECT_VOICE_ID="ANY")
        self.assertTrue(any("FAULT_INJECT" in p for p in s.check_config()))

    def test_staging_label_on_production_database_refused(self):
        s = load(ENVIRONMENT="staging", POSTGREST_URL="https://prooflab-api-x.a.run.app",
                 FAULT_INJECT_VOICE_ID="ANY")
        self.assertTrue(any("not a staging URL" in p for p in s.check_config()))

    def test_unknown_environment_refused(self):
        self.assertTrue(load(ENVIRONMENT="prod").check_config())

    def test_fault_injection_is_inert_outside_staging_even_if_started(self):
        s = load(ENVIRONMENT="production", POSTGREST_URL="https://prooflab-api-x.a.run.app",
                 FAULT_INJECT_VOICE_ID="ANY")
        s.fetch_audio = lambda p: (b"a", "audio/webm")
        s.transcribe = lambda a, c: {"text": "x"}
        s.request_scoring = lambda v: "HTTP 200"
        s.db_rpc = lambda n, a: (200, JOB) if n == "claim_transcription_job" else (200, True)
        with mock.patch.object(s.time, "sleep", side_effect=AssertionError("fault injection ran")):
            with redirect_stdout(io.StringIO()):
                code, _ = s.process_job(VID, "t", 0)
        self.assertEqual(code, 200)

    def test_startup_exits_on_bad_config(self):
        import subprocess
        env = {**BASE_ENV, "FUNCTIONS_URL": "", "PATH": os.environ.get("PATH", ""),
               "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")}
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py")
        r = subprocess.run([sys.executable, path], env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(r.returncode, 1)
        self.assertIn("CONFIG ERROR: FUNCTIONS_URL is not set", r.stdout)


if __name__ == "__main__":
    unittest.main()
