// Structured logs with one request id, so a single student action can be followed through
// every layer (browser -> function -> AI call -> database) by searching that one id.
//
// What it does:
//   * every request runs inside a context {request_id, session_id, function, user}
//   * console.log/warn/error inside a request become one JSON line Cloud Logging understands
//     (severity, message, request_id, function, hashed user, trace) - so the ~160 existing
//     console.error lines are upgraded without editing each function
//   * anything private is scrubbed and long text is cut: emails, tokens, keys, big strings
//
// What it never does: log request bodies, answers, resume text, voice or passwords.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ReqCtx {
  request_id: string;
  session_id?: string;
  fn: string;
  user?: string;   // first 12 hex of sha256(user id): enough to group one student, not to identify them
  trace?: string;  // Cloud Run's trace, so app lines sit under the request line in Logs Explorer
}

export const als = new AsyncLocalStorage<ReqCtx>();

const PROJECT = Deno.env.get('GOOGLE_CLOUD_PROJECT') ?? 'prooflab-508214';
const MAX_TEXT = 400;

const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [token]'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[jwt]'],
  [/\bsk-[A-Za-z0-9]{16,}\b/g, '[key]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[key]'],
];

/** Remove secrets and personal strings, and cut long text. Exported for tests. */
export function scrub(text: string, max = MAX_TEXT): string {
  let s = text;
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  return s.length > max ? `${s.slice(0, max)}... [cut ${s.length - max} chars]` : s;
}

function describe(arg: unknown): string {
  if (typeof arg === 'string') return scrub(arg);
  if (arg instanceof Error) return scrub(`${arg.name}: ${arg.message}\n${arg.stack ?? ''}`, 2000); // stack kept: Error Reporting reads it
  if (arg === undefined) return 'undefined';
  try { return scrub(JSON.stringify(arg) ?? String(arg), 300); } catch { return '[unprintable]'; }
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
export const cleanRequestId = (v: string | null): string => (v && REQUEST_ID.test(v) ? v : crypto.randomUUID());

export async function hashUser(id: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(d)).slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The user id inside a bearer token, for grouping logs only. Not verified and never trusted for access. */
export function subjectOf(authorization: string | null): string | null {
  const t = authorization?.replace(/^Bearer\s+/i, '');
  const part = t?.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json?.sub === 'string' ? json.sub : null;
  } catch { return null; }
}

const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
const SEVERITY = { log: 'INFO', info: 'INFO', warn: 'WARNING', error: 'ERROR', debug: 'DEBUG' } as const;

function emit(severity: string, message: string, extra: Record<string, unknown> = {}) {
  const c = als.getStore();
  const entry: Record<string, unknown> = {
    severity,
    message,
    ...(c ? { request_id: c.request_id, session_id: c.session_id, function: c.fn, user: c.user } : {}),
    ...(c?.trace ? { 'logging.googleapis.com/trace': c.trace } : {}),
    ...extra,
  };
  orig.log(JSON.stringify(entry));
}

/** Make every console.* line structured. Call once when the server starts. */
export function installStructuredConsole() {
  (Object.keys(SEVERITY) as (keyof typeof SEVERITY)[]).forEach((k) => {
    console[k] = (...args: unknown[]) => emit(SEVERITY[k], args.map(describe).join(' '));
  });
}

/** Normal successful requests can be sampled at scale (LOG_SAMPLE=0.1); errors and slow calls are always kept. */
const SAMPLE = Math.min(1, Math.max(0, Number(Deno.env.get('LOG_SAMPLE') ?? '1')));
/** Chatty by design (one batch every few seconds per student): only its failures and slow calls are logged. */
const QUIET = new Set(['client-log']);

/** Run one request inside its context, log how it ended, and hand the id back to the caller. */
export async function withRequestContext(
  fn: string,
  req: Request,
  handler: (req: Request) => Response | Promise<Response>,
): Promise<Response> {
  const sub = subjectOf(req.headers.get('Authorization'));
  const traceHeader = req.headers.get('x-cloud-trace-context')?.split('/')[0];
  const ctx: ReqCtx = {
    request_id: cleanRequestId(req.headers.get('x-request-id')),
    session_id: cleanRequestId(req.headers.get('x-session-id')).slice(0, 64),
    fn,
    user: sub ? await hashUser(sub) : undefined,
    trace: traceHeader ? `projects/${PROJECT}/traces/${traceHeader}` : undefined,
  };
  const started = performance.now();
  return await als.run(ctx, async () => {
    let status = 500;
    try {
      const res = await handler(req);
      status = res.status;
      const headers = new Headers(res.headers);
      headers.set('x-request-id', ctx.request_id);
      headers.set('Access-Control-Expose-Headers', 'x-request-id');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } finally {
      const ms = Math.round(performance.now() - started);
      if (status >= 400 || ms > 2000 || (!QUIET.has(fn) && Math.random() < SAMPLE)) {
        emit(status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO', `${fn} ${status} ${ms}ms`, {
          event: 'request.end', status, duration_ms: ms, method: req.method,
        });
      }
    }
  });
}
