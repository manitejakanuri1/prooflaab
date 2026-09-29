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
  /** Rows the next claim_transcription_recovery will mark failed ("exceeded automatic recovery attempts"). */
  countAboutToExhaust(maxAttempts: number): Promise<{ count: number | null; error: unknown }>;
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
    about_to_exhaust: number | null;   // given up on by the DB this run
    candidates: number;
    reenqueued: number;
    near_limit: number;
    failed: { id: string; kind: string; attempt: number; error: string }[];
    error?: string;
  };
  scoring: { candidates: number; outcomes: Record<string, number>; errors: number; error?: string };
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
    transcription: { about_to_exhaust: null, candidates: 0, reenqueued: 0, near_limit: 0, failed: [] },
    scoring: { candidates: 0, outcomes: {}, errors: 0 },
  };

  // ---------- A. transcription job recovery ----------
  if (!config) {
    // Do not even claim: claiming spends one of each row's bounded recovery
    // attempts, and a broken config would burn them without enqueueing.
    report.transcription.skipped = 'invalid configuration';
  } else {
    const maxAttempts = config.maxReapAttempts ?? DB_DEFAULT_MAX_REAP_ATTEMPTS;
    try {
      const { count, error } = await deps.countAboutToExhaust(maxAttempts);
      if (error) throw error;
      report.transcription.about_to_exhaust = count ?? 0;
    } catch (e) {
      report.transcription.error = `exhaustion check failed: ${errText(e)}`;
    }

    let rows: RecoveryRow[] = [];
    try {
      const { data, error } = await deps.claimRecovery({
        _stale_after_seconds: config.staleAfterSeconds,
        ...(config.maxReapAttempts ? { _max_reap_attempts: config.maxReapAttempts } : {}),
      });
      if (error) throw error;
      rows = data ?? [];
    } catch (e) {
      report.transcription.error = `claim_transcription_recovery failed: ${errText(e)}`;
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
    }
  } catch (e) {
    report.scoring.error = `listing unscored transcripts failed: ${errText(e)}`;
  }

  report.ok = report.config_errors.length === 0
    && !report.transcription.error
    && report.transcription.failed.length === 0
    && !report.transcription.about_to_exhaust
    && !report.scoring.error
    && report.scoring.errors === 0;
  return report;
}

/** One log line per run; severity ERROR when anything failed (alertable). */
export function logReport(report: ReapReport) {
  const line = `TRANSCRIPTION-REAP ${report.ok ? 'OK' : 'PROBLEM'} ${JSON.stringify(report)}`;
  if (report.ok) console.log(line);
  else console.error(line);
  if (report.transcription.about_to_exhaust) {
    console.error(`TRANSCRIPTION-REAP ALERT: ${report.transcription.about_to_exhaust} job(s) exceeded automatic recovery attempts and are now failed`);
  }
}
