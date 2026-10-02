// Rate limiting for edge functions.
//
// Counting happens in Postgres (public.check_rate_limit) rather than in memory:
// edge functions run as many short-lived isolates, so an in-process counter
// resets constantly and caps nothing. The database is the only shared state.
//
// Called through backend.ts serviceRest (service_role on whichever database is in
// use), so a function does not need to wire up a client just to be rate limited.

import { logSecurityEvent } from './audit.ts';
import { serviceRest, telemetryProblem } from './backend.ts';

export interface RateLimitDecision {
  allowed: boolean;
  hits: number;
  limit: number;
  remaining: number;
  reset_at: string;
  retry_after: number;
}

/** Thrown by generateText when a caller has used up its allowance. */
export class RateLimitError extends Error {
  readonly retryAfter: number;
  readonly limit: number;
  constructor(message: string, retryAfter: number, limit: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.limit = limit;
  }
}

const ALLOW_ON_FAILURE: RateLimitDecision = {
  allowed: true,
  hits: 0,
  limit: 0,
  remaining: 0,
  reset_at: '',
  retry_after: 0,
};

/**
 * Records one hit and reports whether it is within the allowance.
 *
 * Fails open. If the database is unreachable the request proceeds: a limiter
 * that turns a database blip into a total outage costs more than the abuse it
 * prevents. A failure is reported through telemetryProblem(), which alerts.
 */
export async function checkRateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  try {
    const res = await serviceRest('rpc/check_rate_limit', {
      method: 'POST',
      body: JSON.stringify({
        p_bucket: bucket,
        p_subject: subject,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res) {
      telemetryProblem('rate-limit', 'no database configured; every request is allowed');
      return ALLOW_ON_FAILURE;
    }
    if (!res.ok) {
      telemetryProblem('rate-limit', `check_rate_limit answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return ALLOW_ON_FAILURE;
    }
    return (await res.json()) as RateLimitDecision;
  } catch (err) {
    telemetryProblem('rate-limit', `check_rate_limit errored: ${err instanceof Error ? err.message : err}`);
    return ALLOW_ON_FAILURE;
  }
}

/**
 * Who to count this request against.
 *
 * A signed-in user is the honest answer. Falling back to the client IP means an
 * unauthenticated flood still gets capped, though shared NAT means several
 * students behind one college network share a bucket — hence the looser limits
 * used for anonymous endpoints.
 */
export function subjectFor(req: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  return `ip:${ip}`;
}

export interface GuardOptions {
  bucket: string;
  limit: number;
  windowSeconds: number;
  userId?: string | null;
  /** Merged into the 429 so the browser is not blocked by CORS on the refusal. */
  corsHeaders?: Record<string, string>;
}

/**
 * Guards an endpoint. Returns a ready-to-send 429 when the caller is over
 * budget, or null when the request may proceed.
 */
export async function guard(req: Request, opts: GuardOptions): Promise<Response | null> {
  const subject = subjectFor(req, opts.userId);
  const decision = await checkRateLimit(opts.bucket, subject, opts.limit, opts.windowSeconds);
  if (decision.allowed) return null;

  // Someone hitting a cap is the clearest signal of abuse this system produces,
  // so it is recorded rather than only refused.
  logSecurityEvent(req, {
    eventType: 'rate_limited',
    severity: 'warning',
    userId: opts.userId ?? null,
    detail: { bucket: opts.bucket, hits: decision.hits, limit: decision.limit },
  });

  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please wait and try again.',
      retry_after_seconds: decision.retry_after,
    }),
    {
      status: 429,
      headers: {
        ...(opts.corsHeaders ?? {}),
        'Content-Type': 'application/json',
        'Retry-After': String(decision.retry_after),
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
      },
    },
  );
}

/** Maps a RateLimitError thrown out of generateText onto a 429 response. */
export function rateLimitResponse(err: unknown, corsHeaders: Record<string, string>): Response | null {
  if (!(err instanceof RateLimitError)) return null;
  return new Response(
    JSON.stringify({ error: err.message, retry_after_seconds: err.retryAfter }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(err.retryAfter),
      },
    },
  );
}
