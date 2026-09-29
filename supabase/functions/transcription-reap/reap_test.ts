// Tests for transcription-reap/reap.ts.
// Run: npx deno test --no-check=remote supabase/functions/transcription-reap/reap_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { readConfig, runReap, type ReapDeps } from "./reap.ts";

const STAGING = {
  ENVIRONMENT: "staging", TRANSCRIPTION_QUEUE: "prooflab-staging-transcription",
  TRANSCRIPTION_WORKER_URL: "https://prooflab-staging-transcription-worker-x.run.app",
  TASKS_INVOKER_SA: "prooflab-staging-tasks-invoker@p.iam.gserviceaccount.com",
};
const PROD = {
  ENVIRONMENT: "production", TRANSCRIPTION_QUEUE: "prooflab-transcription",
  TRANSCRIPTION_WORKER_URL: "https://prooflab-transcription-worker-x.run.app",
  TASKS_INVOKER_SA: "prooflab-tasks-invoker@p.iam.gserviceaccount.com",
};
const envOf = (o: Record<string, string>) => (k: string) => o[k];
const rows = (n: number, attempt = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: `job-${i}`, storage_path: "x", kind: "processing", attempt }));

function deps(over: Partial<ReapDeps> = {}) {
  const calls = { token: 0, tasks: 0, score: 0, claim: 0 };
  const d: ReapDeps = {
    countAboutToExhaust: async () => ({ count: 0, error: null }),
    claimRecovery: async () => { calls.claim++; return { data: [], error: null }; },
    googleToken: async () => { calls.token++; return "tok"; },
    createTask: async () => { calls.tasks++; return { ok: true, status: 200 }; },
    listUnscored: async () => ({ data: [], error: null }),
    score: async () => { calls.score++; return { outcome: "scored" }; },
    ...over,
  };
  return { d, calls };
}

// ---------- configuration ----------
Deno.test("config: staging valid, production valid", () => {
  assertEquals(readConfig(envOf(STAGING)).errors, []);
  assertEquals(readConfig(envOf(PROD)).errors, []);
});
Deno.test("config: no default queue - missing settings are errors", () => {
  for (const k of ["TRANSCRIPTION_QUEUE", "TRANSCRIPTION_WORKER_URL", "TASKS_INVOKER_SA"]) {
    const e = readConfig(envOf({ ...PROD, [k]: "" })).errors;
    assert(e.some((x) => x.includes(k)), k);
  }
  assert(readConfig(envOf({ ...PROD, ENVIRONMENT: "" })).errors.length > 0);
  assert(readConfig(envOf({ ...PROD, ENVIRONMENT: "prod" })).errors.length > 0);
});
Deno.test("config: production may not point at staging resources", () => {
  const e = readConfig(envOf({ ...PROD, TRANSCRIPTION_QUEUE: "prooflab-staging-transcription" })).errors;
  assert(e.some((x) => x.includes("staging resource in production")));
});
Deno.test("config: staging test switches refused in production", () => {
  assert(readConfig(envOf({ ...PROD, FAULT_INJECT_REAP_FAIL: "true" })).errors.some((x) => x.includes("FAULT_INJECT")));
  assert(readConfig(envOf({ ...PROD, MAX_REAP_ATTEMPTS: "2" })).errors.some((x) => x.includes("MAX_REAP_ATTEMPTS")));
});
Deno.test("config: staging label with production resources refused", () => {
  assert(readConfig(envOf({ ...PROD, ENVIRONMENT: "staging" })).errors.length > 0);
});
Deno.test("config error: no claim (attempts not burned), scoring still runs, run fails", async () => {
  const { d, calls } = deps({ listUnscored: async () => ({ data: [{ id: "v1" }], error: null }) });
  const r = await runReap(envOf({ ...PROD, MAX_REAP_ATTEMPTS: "2" }), d);
  assertEquals(calls.claim, 0);
  assertEquals(calls.score, 1);
  assertEquals(r.transcription.skipped, "invalid configuration");
  assertEquals(r.ok, false);
});

// ---------- independence ----------
Deno.test("no jobs to enqueue: no Google token requested", async () => {
  const { d, calls } = deps();
  const r = await runReap(envOf(STAGING), d);
  assertEquals(calls.token, 0);
  assertEquals(r.ok, true);
});
Deno.test("Google token failure: every job reported failed, scoring still runs", async () => {
  const { d, calls } = deps({
    claimRecovery: async () => ({ data: rows(3), error: null }),
    googleToken: async () => { throw new Error("metadata down"); },
    listUnscored: async () => ({ data: [{ id: "v1" }, { id: "v2" }], error: null }),
  });
  const r = await runReap(envOf(STAGING), d);
  assertEquals(r.transcription.failed.length, 3);
  assert(r.transcription.failed.every((f) => f.error.startsWith("google token")));
  assertEquals(calls.score, 2);
  assertEquals(r.ok, false);
});
Deno.test("one enqueue network failure does not stop the other jobs", async () => {
  let n = 0;
  const { d } = deps({
    claimRecovery: async () => ({ data: rows(4), error: null }),
    createTask: async () => { if (n++ === 1) throw new Error("ECONNRESET"); return { ok: true, status: 200 }; },
  });
  const r = await runReap(envOf(STAGING), d);
  assertEquals(r.transcription.reenqueued, 3);
  assertEquals(r.transcription.failed.length, 1);
  assertEquals(r.transcription.failed[0].id, "job-1");
  assertEquals(r.ok, false);
});
Deno.test("Cloud Tasks HTTP 500 for one job is reported; 409 counts as enqueued", async () => {
  const answers = [{ ok: false, status: 500 }, { ok: false, status: 409 }, { ok: true, status: 200 }];
  const { d } = deps({
    claimRecovery: async () => ({ data: rows(3), error: null }),
    createTask: async () => answers.shift()!,
  });
  const r = await runReap(envOf(STAGING), d);
  assertEquals(r.transcription.reenqueued, 2);
  assertEquals(r.transcription.failed[0].error, "cloud tasks HTTP 500");
});
Deno.test("claim_transcription_recovery error: reported, scoring still runs", async () => {
  const { d, calls } = deps({
    claimRecovery: async () => ({ data: null, error: { message: "db down" } }),
    listUnscored: async () => ({ data: [{ id: "v1" }], error: null }),
  });
  const r = await runReap(envOf(STAGING), d);
  assert(r.transcription.error?.includes("db down"));
  assertEquals(calls.score, 1);
  assertEquals(r.ok, false);
});
Deno.test("scoring: one DB error or throw is counted, the rest still scored", async () => {
  const outs = ["scored", "error", "scored"];
  const { d } = deps({
    listUnscored: async () => ({ data: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], error: null }),
    score: async (rec) => { if (rec.id === "d") throw new Error("boom"); return { outcome: outs.shift()! }; },
  });
  const r = await runReap(envOf(STAGING), d);
  assertEquals(r.scoring.outcomes, { scored: 2, error: 2 });
  assertEquals(r.scoring.errors, 2);
  assertEquals(r.ok, false);
});
Deno.test("scoring list error: reported, transcription recovery unaffected", async () => {
  const { d } = deps({
    claimRecovery: async () => ({ data: rows(2), error: null }),
    listUnscored: async () => ({ data: null, error: { message: "timeout" } }),
  });
  const r = await runReap(envOf(STAGING), d);
  assertEquals(r.transcription.reenqueued, 2);
  assert(r.scoring.error?.includes("timeout"));
  assertEquals(r.ok, false);
});

// ---------- bounded recovery limit ----------
Deno.test("jobs about to exhaust the recovery limit make the run fail loudly", async () => {
  const { d } = deps({ countAboutToExhaust: async () => ({ count: 2, error: null }) });
  const r = await runReap(envOf(STAGING), d);
  assertEquals(r.transcription.about_to_exhaust, 2);
  assertEquals(r.ok, false);
});
Deno.test("near-limit jobs are counted (default limit 8)", async () => {
  const { d } = deps({ claimRecovery: async () => ({ data: [...rows(1, 7), ...rows(1, 3)], error: null }) });
  const r = await runReap(envOf(STAGING), d);
  assertEquals(r.transcription.near_limit, 1);
});
Deno.test("staging MAX_REAP_ATTEMPTS override is used for the exhaustion check", async () => {
  let seen = 0;
  const { d } = deps({ countAboutToExhaust: async (m) => { seen = m; return { count: 0, error: null }; } });
  await runReap(envOf({ ...STAGING, MAX_REAP_ATTEMPTS: "2" }), d);
  assertEquals(seen, 2);
});
Deno.test("prolonged Cloud Tasks outage: every run fails visibly until jobs exhaust, then alerts", async () => {
  // simulate 8 consecutive runs of an outage for one job
  let attempt = 0;
  let exhausted = false;
  for (let run = 1; run <= 9; run++) {
    const { d } = deps({
      countAboutToExhaust: async () => ({ count: attempt >= 8 && !exhausted ? 1 : 0, error: null }),
      claimRecovery: async () => {
        if (attempt >= 8) { exhausted = true; return { data: [], error: null }; }
        attempt++;
        return { data: rows(1, attempt), error: null };
      },
      createTask: async () => ({ ok: false, status: 503 }),
    });
    const r = await runReap(envOf(STAGING), d);
    assertEquals(r.ok, false, `run ${run} must be visible as a failure`);
    if (run === 9) assertEquals(r.transcription.about_to_exhaust, 1);
  }
});

// ---------- fault injection ----------
Deno.test("staging FAULT_INJECT_REAP_FAIL: no token, no task, reported as failed", async () => {
  const { d, calls } = deps({ claimRecovery: async () => ({ data: rows(2), error: null }) });
  const r = await runReap(envOf({ ...STAGING, FAULT_INJECT_REAP_FAIL: "true" }), d);
  assertEquals(calls.token, 0);
  assertEquals(calls.tasks, 0);
  assertEquals(r.transcription.failed.length, 2);
});
