import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { schedulerCaller } from "../_shared/googleIdentity.ts";
import { pagesNeedingLots, reopenForRewrite, writeLotTemplate } from "../_shared/lot-pipeline.ts";

/**
 * The timed jobs, triggered by Google Cloud Scheduler.
 *
 * On Supabase these six ran inside the database on pg_cron. Cloud SQL does not
 * offer pg_cron, and nothing replaced it on the move, so from 12 September no
 * student received a daily Lot, no week was scored and no season moved on - with
 * every button still working, so nothing looked wrong from inside the app.
 *
 * A closed list, not a function name taken from the request: whoever holds the
 * secret can start these jobs and nothing else. The schedule itself lives in
 * Cloud Scheduler; the times are repeated here only so the next person reading
 * this knows what to expect.
 */
const JOBS: Record<string, string> = {
  'nightly-squads':   'form_all_colleges',       // daily  05:35 IST
  'extend-fixtures':  'extend_all_fixtures',     // daily  05:37 IST
  'daily-lots':       'assign_todays_lots',      // daily  05:40 IST
  'weekly-seasons':   'run_all_seasons',         // Sunday 23:30 IST
  'weekly-progress':  'notify_weekly_progress',  // Sunday 23:45 IST
  'weekly-plan':      'plan_all_weeks',          // Monday 08:00 IST
  'prune-events':     'prune_app_events',        // daily  03:10 IST (keeps the step trail 90 days)
  // 'pregenerate-lots' (no RPC; handled above): writes Lots before 05:40 IST.
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  // Who may start a job (G11): Cloud Scheduler's own Google identity, or - until
  // SCHEDULER_AUTH=oidc turns it off - the shared webhook secret.
  if (!(await schedulerCaller(req))) {
    return reply({ error: 'Unauthorized' }, 401);
  }

  const job = new URL(req.url).searchParams.get('job') ?? '';

  // Writes Lots before students arrive (Wave 4): pages with no Lot, a seed Lot,
  // or a Lot whose stored wording breaks the contract. Bounded per run (each page
  // costs up to ~7 AI calls, once, for every future student) and run in parallel
  // so a batch fits well inside the 300 s request limit.
  if (job === 'pregenerate-lots') {
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const limit = Math.min(3, Math.max(1, Number(new URL(req.url).searchParams.get('limit') ?? 3) || 3));
    const pages = await pagesNeedingLots(db, limit);
    const started = Date.now();
    const results = await Promise.all(pages.map(async (id) => {
      try {
        await reopenForRewrite(db, id);
        return { id, ...(await writeLotTemplate(db, id, null)) };
      } catch (e) {
        return { id, written: false, reason: (e as Error).message };
      }
    }));
    const written = results.filter((r) => r.written).length;
    console.log(`scheduled-job pregenerate-lots: ${written}/${pages.length} written in ${Date.now() - started}ms`, JSON.stringify(results).slice(0, 800));
    if (pages.length && !written) console.error(`JOB SANITY: pregenerate-lots wrote 0 of ${pages.length} pages`);
    return reply({ ok: true, job, pages: pages.length, written, results });
  }

  const fn = JOBS[job];
  if (!fn) return reply({ error: 'unknown job' }, 400);

  const started = Date.now();
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  // daily-lots goes through the students in batches (migration 76): one request for
  // everyone is cut off by the API's 30-second limit once there are enough students.
  const { data, error } = job === 'daily-lots' ? await dailyLotsInBatches(db, started) : await db.rpc(fn);
  const ms = Date.now() - started;

  if (error) {
    // A non-2xx makes Cloud Scheduler record the run as failed and retry it,
    // which is what should happen: a silent failure here is how this broke.
    console.error(`scheduled-job ${job} (${fn}) failed after ${ms}ms:`, error.message);
    return reply({ ok: false, job, error: error.message }, 500);
  }

  console.log(`scheduled-job ${job} (${fn}) ok in ${ms}ms`, JSON.stringify(data ?? null).slice(0, 500));

  // The job can succeed (no thrown error) while doing nothing useful - that is exactly how this
  // broke before Cloud Scheduler existed (see the comment at the top). These checks catch that:
  // a distinct log line, watched by its own alert, rather than folding into the job's own success/fail.
  await sanityCheck(db, job, data).catch((e) => console.error(`scheduled-job ${job}: sanity check itself failed:`, e));

  // A job that ran but failed at its purpose is a failure (migration 75): answer 500 so Cloud
  // Scheduler retries it and the scheduled-job alert fires. Only daily-lots reports a status today.
  const state = jobState(data);
  if (state === 'failure') {
    console.error(`JOB FAILED: ${job} reported status=failure: ${JSON.stringify(data ?? null).slice(0, 300)}`);
    return reply({ ok: false, job, ms, status: state, result: data ?? null }, 500);
  }
  return reply({ ok: true, job, ms, status: state, result: data ?? null });
});

const BATCH = 1000;
const TIME_BUDGET_MS = 240_000;   // the function itself is allowed 300 s

/** Same thresholds as migration 75: 5% or 50 students failing is a failure. */
export function dailyLotsStatus(failed: number, students: number): 'success' | 'partial_failure' | 'failure' {
  if (failed === 0) return 'success';
  if (failed >= 50 || failed / Math.max(students, 1) >= 0.05) return 'failure';
  return 'partial_failure';
}

// deno-lint-ignore no-explicit-any
async function dailyLotsInBatches(db: any, started: number): Promise<{ data: any; error: { message: string } | null }> {
  const total = { lots_created: 0, already_had_one: 0, failed: 0, students: 0, batches: 0,
    first_error: null as string | null, first_failed_student: null as string | null };
  let after: string | null = null;
  for (;;) {
    // deno-lint-ignore no-explicit-any
    const { data, error }: { data: any; error: { message: string } | null } =
      await db.rpc('assign_todays_lots_batch', { _after: after, _limit: BATCH });
    if (error) {
      // What earlier batches created stays created; the run as a whole did not finish.
      return { data: null, error: { message: `batch ${total.batches + 1} failed after ${total.lots_created} Lots: ${error.message}` } };
    }
    total.batches++;
    total.lots_created += data.lots_created; total.already_had_one += data.already_had_one;
    total.failed += data.failed; total.students += data.students;
    total.first_error ??= data.first_error; total.first_failed_student ??= data.first_failed_student;
    if (data.done) break;
    after = data.last_id;
    if (Date.now() - started > TIME_BUDGET_MS) {
      return { data: null, error: { message: `ran out of time after ${total.students} students (${total.lots_created} Lots created); the retry continues` } };
    }
  }
  const status = dailyLotsStatus(total.failed, total.students);
  return { data: { ok: status !== 'failure', status, ...total, ran_at: new Date().toISOString() }, error: null };
}

/** success | partial_failure | failure. A job that reports no status of its own is a success here. */
export function jobState(data: unknown): 'success' | 'partial_failure' | 'failure' {
  const d = (data ?? {}) as { status?: unknown; ok?: unknown };
  if (d.status === 'failure' || d.ok === false) return 'failure';
  if (d.status === 'partial_failure') return 'partial_failure';
  return 'success';
}

/**
 * A job can return ok (no thrown error) while doing nothing useful - that is exactly how this broke
 * before Cloud Scheduler existed (see the comment at the top). daily-lots: check the real table, since
 * "0 created" is only wrong when nobody already has today's task. weekly-seasons: trust the function's
 * own count rather than re-deriving it - a rerun that finds everyone already scored also legitimately
 * writes 0 new rows, and re-guessing that from a timestamp window produced a false alarm in testing.
 */
// deno-lint-ignore no-explicit-any
async function sanityCheck(db: any, job: string, data: any) {
  if (job === 'daily-lots') {
    const today = new Date().toISOString().slice(0, 10);
    const [{ count: active }, { count: made }] = await Promise.all([
      db.from('student_profiles').select('id', { count: 'exact', head: true }).gte('last_active', new Date(Date.now() - 14 * 86400_000).toISOString()),
      db.from('tasks').select('id', { count: 'exact', head: true }).eq('lot_date', today),
    ]);
    if ((active ?? 0) > 0 && (made ?? 0) === 0) {
      console.error(`JOB SANITY: daily-lots ran but ${today} has 0 tasks in total (new or existing), though ${active} students were active in the last 14 days.`);
    }
    // Migration 68: a student whose Lot could not be created no longer stops the others,
    // so it has to be said out loud here or nobody would know. No student data in the line:
    // a count, one id and the database's error text.
    const failed = Number(data?.failed ?? 0);
    if (failed > 0 && data?.status !== 'failure') {
      console.error(`JOB SANITY: daily-lots could not create a Lot for ${failed} student(s). First: ${data?.first_failed_student} - ${String(data?.first_error ?? '').slice(0, 200)}`);
    }
  }
  if (job === 'weekly-seasons') {
    const seasons = Number(data?.seasons_scored ?? 0) + Number(data?.seasons_closed ?? 0) + Number(data?.seasons_advanced ?? 0);
    const { count: active } = await db.from('seasons').select('id', { count: 'exact', head: true }).eq('status', 'active');
    if ((active ?? 0) > 0 && seasons === 0) {
      console.error(`JOB SANITY: weekly-seasons ran but scored/closed/advanced 0 seasons, though ${active} seasons are active.`);
    }
  }
}
