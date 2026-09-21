import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";

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
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  const expected = Deno.env.get('WEBHOOK_SECRET');
  if (!expected) {
    console.error('WEBHOOK_SECRET not configured');
    return reply({ error: 'Server configuration error' }, 500);
  }
  if (req.headers.get('x-webhook-secret') !== expected) {
    return reply({ error: 'Unauthorized' }, 401);
  }

  const job = new URL(req.url).searchParams.get('job') ?? '';
  const fn = JOBS[job];
  if (!fn) return reply({ error: 'unknown job' }, 400);

  const started = Date.now();
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data, error } = await db.rpc(fn);
  const ms = Date.now() - started;

  if (error) {
    // A non-2xx makes Cloud Scheduler record the run as failed and retry it,
    // which is what should happen: a silent failure here is how this broke.
    console.error(`scheduled-job ${job} (${fn}) failed after ${ms}ms:`, error.message);
    return reply({ ok: false, job, error: error.message }, 500);
  }

  console.log(`scheduled-job ${job} (${fn}) ok in ${ms}ms`, JSON.stringify(data ?? null).slice(0, 500));
  return reply({ ok: true, job, ms, result: data ?? null });
});
