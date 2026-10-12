// S42: the run-control pieces of the live suite. OFFLINE, fake clock and timers.
//   node --test scripts/dev-tools/sidhu_s42_run_control.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRunControl, TimeoutError, writeAtomic, ordered, resumeFrom, rowKey } from "./sidhu_s42_run_control.mjs";

function fakeTimers() {
  let t = 1_800_000_000_000; const jobs = new Map(); let id = 0;
  return {
    now: () => t,
    setTimeout: (f, ms) => { jobs.set(++id, { f, at: t + ms }); return id; }, clearTimeout: (i) => jobs.delete(i),
    setInterval: (f, ms) => { const i = ++id; jobs.set(i, { f, at: t + ms, every: ms }); return { unref() {}, i }; },
    clearInterval: (h) => jobs.delete(h?.i ?? h),
    advance(ms) { const end = t + ms; for (;;) { const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break; const [k, j] = due; t = j.at; if (j.every) j.at += j.every; else jobs.delete(k); j.f(); } t = end; },
  };
}

test("progress lines carry time, elapsed, step time and memory", () => {
  const lines = []; const T = fakeTimers();
  const rc = createRunControl({ log: (l) => lines.push(l), now: T.now, memory: () => 300 * 1048576, timers: T });
  T.advance(4000); rc.progress("admin screen 1/24 /admin/dashboard");
  assert.match(lines[0], /^\[\d\d:\d\d:\d\d \+4s step 4\.0s rss 300MB\] admin screen 1\/24/);
});

test("bounded: a step past its deadline fails with the step named; a quick step returns its value", async () => {
  const T = fakeTimers(); const rc = createRunControl({ log: () => {}, now: T.now, timers: T });
  assert.equal(await rc.bounded(1000, "fast", async () => 7), 7);
  const slow = rc.bounded(5000, "click 'Export' on /admin/dashboard", () => new Promise(() => {}));
  T.advance(5001);
  await assert.rejects(slow, (e) => e instanceof TimeoutError && /TIMEOUT after 5s: click 'Export'/.test(e.message));
});

test("watchdog: silent past the limit -> reports where it is stuck and calls the recovery; progress resets it", () => {
  const lines = []; const T = fakeTimers(); const stalls = [];
  const rc = createRunControl({ log: (l) => lines.push(l), now: T.now, timers: T, stallMs: 60_000 });
  rc.progress("admin SAFE 37/200 'People'");
  const stop = rc.watchdog((where, n) => stalls.push([where, n]), 10_000);
  T.advance(50_000); assert.equal(stalls.length, 0, "not yet");
  T.advance(20_000); assert.deepEqual(stalls, [["admin SAFE 37/200 'People'", 1]]);
  assert.ok(lines.some((l) => /WATCHDOG: no progress for \d+s at "admin SAFE 37\/200 'People'"/.test(l)));
  rc.progress("admin SAFE 38/200"); T.advance(50_000); assert.equal(stalls.length, 1, "progress resets the clock");
  stop();
});

test("checkpoints are atomic (temp file, then rename)", () => {
  const ops = [];
  writeAtomic("out/matrix.partial.json", { a: 1 }, { writeFileSync: (p, d) => ops.push(["write", p, d]), renameSync: (a, b) => ops.push(["rename", a, b]) });
  assert.equal(ops[0][0], "write"); assert.match(ops[0][1], /^out\/matrix\.partial\.json\.tmp-\d+$/);
  assert.deepEqual(ops[1], ["rename", ops[0][1], "out/matrix.partial.json"]);
});

test("rows are tested in one fixed order", () => {
  const rows = [{ role: "tpo", url: "/b", class: "SAFE", control: "x" }, { role: "admin", url: "/z", class: "SCREEN", control: "y" }, { role: "admin", url: "/a", class: "SAFE", control: "z" }];
  assert.deepEqual(ordered(rows).map((r) => `${r.role}${r.url}`), ["admin/a", "admin/z", "tpo/b"]);
  assert.deepEqual(ordered([...rows].reverse()), ordered(rows));
});

test("resume: finished rows keep their result, unfinished ones run again, recipes are never repeated, other builds refused", () => {
  const mk = () => [{ role: "admin", class: "SCREEN", url: "/a", control: "s", status: "NOT_TESTED" }, { role: "admin", class: "SAFE", url: "/a", control: "t", status: "NOT_TESTED" }];
  const rows = mk();
  const old = { entry: "index-Ju1L-FZy.js", rows: [{ ...rows[0], status: "PASS", liveResult: "opened" }, { ...rows[1], status: "NOT_TESTED" }],
    extra: [{ class: "RECIPE", control: "admin-review-approve", role: "admin", status: "PASS" }, { class: "ISOLATION", status: "PASS" }] };
  const r = resumeFrom("cp.json", rows, { entry: "index-Ju1L-FZy.js", exists: () => true, read: () => old });
  assert.equal(r.resumed, 1);
  assert.deepEqual(rows.map((x) => x.status), ["PASS", "NOT_TESTED"]);
  assert.deepEqual(r.recipes.map((x) => x.control), ["admin-review-approve"], "the write recipe is not run again");
  assert.throws(() => resumeFrom("cp.json", mk(), { entry: "index-OTHER.js", exists: () => true, read: () => old }), /refusing to mix builds/);
  assert.deepEqual(resumeFrom(undefined, mk()), { resumed: 0, recipes: [] });
  assert.equal(rowKey(rows[0]), "admin|SCREEN|/a|s");
});
