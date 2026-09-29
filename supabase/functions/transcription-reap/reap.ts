/**
 * transcription-reap's logic, separate from the HTTP wrapper so it can be
 * tested with fakes (reap_test.ts). Two independent recoveries per run:
 *
 *  A. transcription jobs: claim_transcription_recovery (migration 43) hands
 *     out stuck jobs; each is re-enqueued to Cloud Tasks on its own. A
 *     failure for one job (or a Google token failure) never stops the others,
 *     and never stops part B.
 *  B. scoring: server transcripts saved but never scored (Step 6 G1).
 *
 * Every failure is counted and named in the result, and the run is reported
 * as failed (HTTP 500) so the existing "scheduler job failed" alert fires.
 * Logs carry ids, counts and error kinds only - never transcripts or notes.
 */

/** migration 43's default for _max_reap_attempts. */
export const DB_DEFAULT_MAX_REAP_ATTEMPTS = 8;
/** Same TTL claim_voice_scoring uses by default (migration 45). */
export const SCORE_CLAIM_TTL_SECONDS = 120;
export const MAX_SCORE_PER_RUN = 5;
/** A job at or above this recovery attempt is reported as close to giving up. */
export const NEAR_LIMIT_MARGIN = 2;
/** transcription_error migration 43 writes when it gives up on a job. */
export const EXHAUSTED_ERROR = 'exceeded automatic recovery attempts';

/** scoreRecording outcomes that are normal, not problems. */
export const EXPECTED_SCORE_OUTCOMES = new Set(['scored', 'already', 'too_short', 'pending', 'lost_race', 'not_found']);
/** A terminal AI scoring failure: the row is now 'failed' and is never selected again. */
export const TERMINAL_SCORE_OUTCOMES = new Set(['failed']);

export interface ReapConfig {
  environment: 'staging' | 'production';
  project: string;
  location: string;
  queue: string;
  workerUrl: string;
  invokerSa: string;
  staleAfterSeconds: number;
  maxReapAttempts: number | null;   // staging test override only
  faultInjectReapFail: boolean;     // staging test switch only
}

/** Reads and checks settings. Returns the config, or the list of problems. */
export function readConfig(env: (k: string) => string | undefined):
  { config: ReapConfig | null; errors: string[] } {
  const errors: string[] = [];
  const environment = env('ENVIRONMENT');
  if (environment !== 'staging' && environment !== 'production') {
    errors.push(`ENVIRONMENT must be staging or production (got ${JSON.stringify(environment ?? null)})`);
  }
  // No defaults for these: production must never fall back to staging's queue.
  const queue = env('TRANSCRIPTION_QUEUE') ?? '';
  const workerUrl = env('TRANSCRIPTION_WORKER_URL') ?? '';
  const invokerSa = env('TASKS_INVOKER_SA') ?? '';
  for (const [k, v] of [['TRANSCRIPTION_QUEUE', queue], ['TRANSCRIPTION_WORKER_URL', workerUrl], ['TASKS_INVOKER_SA', invokerSa]]) {
    if (!v) errors.push(`${k} is not set`);
  }
  const isStagingName = (s: string) => /staging/i.test(s);
  if (environment === 'production') {
    for (const [k, v] of [['TRANSCRIPTION_QUEUE', queue], ['TRANSCRIPTION_WORKER_URL', workerUrl], ['TASKS_INVOKER_SA', invokerSa]]) {
      if (v && isStagingName(v)) errors.push(`${k} points at a staging resource in production`);
    }
    if (env('FAULT_INJECT_REAP_FAIL')) errors.push('FAULT_INJECT_REAP_FAIL is a staging test switch; not allowed in production');
    if (env('MAX_REAP_ATTEMPTS')) errors.push('MAX_REAP_ATTEMPTS is a staging test override; not allowed in production');
  }
  if (environment === 'staging') {
    for (const [k, v] of [['TRANSCRIPTION_QUEUE', queue], ['TRANSCRIPTION_WORKER_URL', workerUrl], ['TASKS_INVOKER_SA', invokerSa]]) {
      if (v && !isStagingName(v)) errors.push(`${k} is not a staging resource but ENVIRONMENT=staging`);
    }
  }
  const stale = Number(env('STALE_AFTER_SECONDS') ?? '180');
  if (!Number.isInteger(stale) || stale < 1) errors.push('STALE_AFTER_SECONDS must be a positive integer');
  const maxRaw = env('MAX_REAP_ATTEMPTS');
  const maxReap = maxRaw ? Number(maxRaw) : null;
  if (maxReap !== null && (!Number.isInteger(maxReap) || maxReap < 1)) errors.push('MAX_REAP_ATTEMPTS must be a positive integer');

  if (errors.length) return { config: null, errors };
  return {
    config: {
      environment: environment as 'staging' | 'production',
      project: env('GCP_PROJECT') ?? 'prooflab-508214',
      location: env('TASKS_LOCATION') ?? 'asia-south1',
      queue, workerUrl, invokerSa,
      staleAfterSeconds: stale,
      maxReapAttempts: maxReap,
      faultInjectReapFail: environment === 'staging' && env('FAULT_INJECT_REAP_FAIL') === 'true',
    },
    errors: [],
  };
}

type RecoveryRow = { id: string; storage_path: string; kind: string; attempt: number };

export interface ReapDeps {
  /** Ids the next claim_transcription_recovery will mark failed (at the limit, still pending/processing). */
  listAtLimit(maxAttempts: number): Promise<{ data: { id: string }[] | null; error: unknown }>;
  /** Of these ids, the ones the database now shows as failed with EXHAUSTED_ERROR. */
  confirmExhausted(ids: string[]): Promise<{ data: { id: string }[] | null; error: unknown }>;
  claimRecovery(args: Record<string, number>): Promise<{ data: RecoveryRow[] | null; error: unknown }>;
  googleToken(): Promise<string>;
  createTask(token: string, body: unknown, cfg: ReapConfig): Promise<{ ok: boolean; status: number }>;
  listUnscored(cutoffIso: string, limit: number): Promise<{ data: { id: string }[] | null; error: unknown }>;
  score(rec: { id: string }): Promise<{ outcome: string }>;
}

export interface ReapReport {
  ok: boolean;
  config_errors: string[];
  transcription: {
    skipped?: string;
    at_limit: string[];                // seen at the recovery limit before this run's claim
    exhausted_confirmed: string[];     // confirmed failed by the database after the claim
    exhaustion_unconfirmed?: string;   // why at_limit jobs could not be confirmed
    candidates: number;
    reenqueued: number;
    near_limit: number;
    failed: { id: string; kind: string; attempt: number; error: string }[];
    error?: string;
  };
  scoring: {
    candidates: number;
    outcomes: Record<string, number>;
    errors: number;                 // database errors ('error' or a throw)
    terminal_failures: string[];    // ids whose AI scoring failed for good ('failed')
    unexpected: string[];           // any outcome not known here (treated as a problem)
    error?: string;
  };
}

const errText = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.slice(0, 160);
};

export async function runReap(
  env: (k: string) => string | undefined,
  deps: ReapDeps,
  now: () => number = Date.now,
): Promise<ReapReport> {
  const { config, errors } = readConfig(env);
  const report: ReapReport = {
    ok: true,
    config_errors: errors,
    transcription: { at_limit: [], exhausted_confirmed: [], candidates: 0, reenqueued: 0, near_limit: 0, failed: [] },
    scoring: { candidates: 0, outcomes: {}, errors: 0, terminal_failures: [], unexpected: [] },
  };

  // ---------- A. transcription job recovery ----------
  if (!config) {
    // Do not even claim: claiming spends one of each row's bounded recovery
    // attempts, and a broken config would burn them without enqueueing.
    report.transcription.skipped = 'invalid configuration';
  } else {
    const maxAttempts = config.maxReapAttempts ?? DB_DEFAULT_MAX_REAP_ATTEMPTS;
    try {
      const { data, error } = await deps.listAtLimit(maxAttempts);
      if (error) throw error;
      report.transcription.at_limit = (data ?? []).map((r) => r.id);
    } catch (e) {
      report.transcription.error = `recovery-limit check failed: ${errText(e)}`;
    }

    let rows: RecoveryRow[] = [];
    let claimOk = false;
    try {
      const { data, error } = await deps.claimRecovery({
        _stale_after_seconds: config.staleAfterSeconds,
        ...(config.maxReapAttempts ? { _max_reap_attempts: config.maxReapAttempts } : {}),
      });
      if (error) throw error;
      rows = data ?? [];
      claimOk = true;
    } catch (e) {
      report.transcription.error = `claim_transcription_recovery failed: ${errText(e)}`;
    }

    // Only the database can say a job was given up on: the claim marks at-limit
    // jobs failed, so confirm by reading them back - never assume it happened.
    const atLimit = report.transcription.at_limit;
    if (atLimit.length) {
      if (!claimOk) {
        report.transcription.exhaustion_unconfirmed =
          'claim_transcription_recovery failed, so these jobs were not marked failed this run';
      } else {
        try {
          const { data, error } = await deps.confirmExhausted(atLimit);
          if (error) throw error;
          report.transcription.exhausted_confirmed = (data ?? []).map((r) => r.id);
          const missing = atLimit.length - report.transcription.exhausted_confirmed.length;
          if (missing > 0) {
            report.transcription.exhaustion_unconfirmed = `${missing} at-limit job(s) not shown as failed after the claim`;
          }
        } catch (e) {
          report.transcription.exhaustion_unconfirmed = `could not confirm: ${errText(e)}`;
        }
      }
    }
    report.transcription.candidates = rows.length;
    report.transcription.near_limit = rows.filter((r) => r.attempt >= maxAttempts - NEAR_LIMIT_MARGIN).length;

    if (rows.length > 0) {
      let token: string | null = null;
      if (!config.faultInjectReapFail) {
        try {
          token = await deps.googleToken();
        } catch (e) {
          for (const r of rows) {
            report.transcription.failed.push({ id: r.id, kind: r.kind, attempt: r.attempt, error: `google token: ${errText(e)}` });
          }
        }
      }
      for (const row of rows) {
        if (config.faultInjectReapFail) {
          report.transcription.failed.push({ id: row.id, kind: row.kind, attempt: row.attempt, error: 'fault injection (staging)' });
          continue;
        }
        if (!token) continue; // already recorded above
        // Named by this row's own reap-attempt count: two attempts get two
        // names, a retried call of the SAME attempt hits ALREADY_EXISTS.
        const body = {
          task: {
            name: `projects/${config.project}/locations/${config.location}/queues/${config.queue}/tasks/transcribe-${row.id}-reap-${row.attempt}`,
            httpRequest: {
              httpMethod: 'POST',
              url: `${config.workerUrl}/transcribe-job`,
              headers: { 'Content-Type': 'application/json' },
              body: btoa(JSON.stringify({ voice_id: row.id })),
              oidcToken: { serviceAccountEmail: config.invokerSa, audience: config.workerUrl },
            },
          },
        };
        try {
          const res = await deps.createTask(token, body, config);
          if (res.ok || res.status === 409) report.transcription.reenqueued++;
          else report.transcription.failed.push({ id: row.id, kind: row.kind, attempt: row.attempt, error: `cloud tasks HTTP ${res.status}` });
        } catch (e) {
          report.transcription.failed.push({ id: row.id, kind: row.kind, attempt: row.attempt, error: `cloud tasks: ${errText(e)}` });
        }
      }
    }
  }

  // ---------- B. scoring recovery (independent of A) ----------
  try {
    const cutoff = new Date(now() - SCORE_CLAIM_TTL_SECONDS * 1000).toISOString();
    const { data, error } = await deps.listUnscored(cutoff, MAX_SCORE_PER_RUN);
    if (error) throw error;
    const recs = data ?? [];
    report.scoring.candidates = recs.length;
    for (const rec of recs) {
      let outcome: string;
      try {
        outcome = (await deps.score(rec)).outcome;
      } catch (e) {
        outcome = 'error';
        console.error(`transcription-reap: scoring threw for ${rec.id}: ${errText(e)}`);
      }
      report.scoring.outcomes[outcome] = (report.scoring.outcomes[outcome] ?? 0) + 1;
      if (outcome === 'error') report.scoring.errors++;
      else if (TERMINAL_SCORE_OUTCOMES.has(outcome)) report.scoring.terminal_failures.push(rec.id);
      else if (!EXPECTED_SCORE_OUTCOMES.has(outcome)) report.scoring.unexpected.push(rec.id);
    }
  } catch (e) {
    report.scoring.error = `listing unscored transcripts failed: ${errText(e)}`;
  }

  report.ok = report.config_errors.length === 0
    && !report.transcription.error
    && report.transcription.failed.length === 0
    && report.transcription.at_limit.length === 0
    && !report.scoring.error
    && report.scoring.errors === 0
    && report.scoring.terminal_failures.length === 0
    && report.scoring.unexpected.length === 0;
  return report;
}

/** One log line per run; severity ERROR when anything failed (alertable). */
export function logReport(report: ReapReport) {
  const line = `TRANSCRIPTION-REAP ${report.ok ? 'OK' : 'PROBLEM'} ${JSON.stringify(report)}`;
  if (report.ok) console.log(line);
  else console.error(line);
  const t = report.transcription;
  if (t.exhausted_confirmed.length) {
    console.error(`TRANSCRIPTION-REAP ALERT: ${t.exhausted_confirmed.length} job(s) exceeded automatic recovery attempts and are now failed (confirmed): ${t.exhausted_confirmed.join(',')}`);
  }
  const unconfirmed = t.at_limit.filter((id) => !t.exhausted_confirmed.includes(id));
  if (unconfirmed.length) {
    console.error(`TRANSCRIPTION-REAP ALERT: ${unconfirmed.length} job(s) at the recovery limit, NOT confirmed failed (${t.exhaustion_unconfirmed ?? 'unknown'}): ${unconfirmed.join(',')}`);
  }
  if (report.scoring.terminal_failures.length) {
    console.error(`TRANSCRIPTION-REAP ALERT: ${report.scoring.terminal_failures.length} recording(s) failed AI scoring for good (marked failed, not retried): ${report.scoring.terminal_failures.join(',')}`);
  }
}
