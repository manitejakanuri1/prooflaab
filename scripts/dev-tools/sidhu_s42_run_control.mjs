// S42: keeps a long live E2E run honest and observable. Used by sidhu_s32_live_e2e.mjs.
//
// Why: TEJA's authenticated run (13 Oct, release 3847f3e) printed its last line after the 24 Admin screens and then
// stayed silent. The suite logged nothing per control, took no screenshot for clicked controls, had no deadline per
// step, no watchdog and no checkpoint, so "slow", "stuck" and "dead" looked the same and a stop lost everything.
//
//   progress  - one timestamped line per role / phase / row: elapsed, step time, memory
//   bounded   - every browser step has a deadline; a timeout is a FAIL with the step named, never a silent wait
//   watchdog  - no progress for `stallMs`: says where it is stuck and fires `onStall` (the suite resets the page)
//   checkpoint- the whole matrix is written atomically (tmp + rename) as rows finish, so a stop loses nothing
//   resume    - a rerun skips rows that already have a final result and never repeats a write recipe
import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";

export const FINAL = (s) => typeof s === "string" && s !== "" && s !== "NOT_TESTED";

export class TimeoutError extends Error {
  constructor(what, ms) { super(`TIMEOUT after ${Math.round(ms / 1000)}s: ${what}`); this.name = "TimeoutError"; }
}

export function createRunControl({ log = console.log, now = Date.now, memory = () => process.memoryUsage().rss, stallMs = 6 * 60_000, timers = globalThis } = {}) {
  const t0 = now();
  let last = now(), where = "start", stalls = 0, timer = null;
  const mb = (b) => `${Math.round(b / 1048576)}MB`;
  const stamp = () => new Date(now()).toISOString().slice(11, 19);

  function progress(msg) {
    const t = now();
    log(`[${stamp()} +${Math.round((t - t0) / 1000)}s step ${((t - last) / 1000).toFixed(1)}s rss ${mb(memory())}] ${msg}`);
    last = t; where = msg; stalls = 0;
  }

  /** Runs fn with a deadline. On timeout the caller gets a TimeoutError naming the step; fn is not awaited further. */
  async function bounded(ms, what, fn) {
    let id;
    const deadline = new Promise((_, reject) => { id = timers.setTimeout(() => reject(new TimeoutError(what, ms)), ms); });
    try { return await Promise.race([Promise.resolve().then(fn), deadline]); }
    finally { timers.clearTimeout(id); }
  }

  /** Checks every `everyMs`; after `stallMs` without progress, reports and calls onStall(where, count). */
  function watchdog(onStall, everyMs = 30_000) {
    timer = timers.setInterval(() => {
      if (now() - last < stallMs) return;
      stalls += 1;
      log(`WATCHDOG: no progress for ${Math.round((now() - last) / 1000)}s at "${where}" (stall ${stalls}, rss ${mb(memory())})`);
      try { onStall(where, stalls); } catch (e) { log(`WATCHDOG: recovery failed: ${e.message}`); }
      last = now();
    }, everyMs);
    timer?.unref?.();
    return () => timers.clearInterval(timer);
  }

  return { progress, bounded, watchdog, elapsed: () => now() - t0, where: () => where };
}

/** Writes JSON atomically: a reader (or a crash) never sees half a file. */
export function writeAtomic(path, data, fs = { writeFileSync, renameSync }) {
  const tmp = `${path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, path);
}

/** Rows in a fixed order (role, page url, control), so two runs test in the same order and resumes line up. */
export function ordered(rows) {
  return [...rows].sort((a, b) => `${a.role}\u0000${a.url}\u0000${a.class}\u0000${a.control}`.localeCompare(`${b.role}\u0000${b.url}\u0000${b.class}\u0000${b.control}`));
}

export const rowKey = (r) => `${r.role}|${r.class}|${r.url}|${r.control}`;

/**
 * Applies an earlier checkpoint: rows with a final status keep it (and are skipped); recipe results already recorded
 * are returned so the run does not perform the same write twice. Only a checkpoint of the same build is accepted.
 */
export function resumeFrom(path, rows, { entry, read = (p) => JSON.parse(readFileSync(p, "utf8")), exists = existsSync } = {}) {
  if (!path || !exists(path)) return { resumed: 0, recipes: [] };
  const old = read(path);
  if (entry && old.entry && old.entry !== entry) throw new Error(`checkpoint is for ${old.entry}, this run expects ${entry}: refusing to mix builds`);
  const done = new Map((old.rows ?? []).filter((r) => FINAL(r.status)).map((r) => [rowKey(r), r]));
  let resumed = 0;
  for (const r of rows) {
    const d = done.get(rowKey(r));
    if (d) { r.status = d.status; r.liveResult = d.liveResult; r.evidence = d.evidence; r.resumed = true; resumed += 1; }
  }
  const recipes = (old.extra ?? []).filter((x) => x.class === "RECIPE" && FINAL(x.status));
  return { resumed, recipes };
}
