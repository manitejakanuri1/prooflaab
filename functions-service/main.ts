// All 41 edge functions, in one Cloud Run service.
//
// Supabase runs each function as its own tiny process, reached at
// /functions/v1/<name>. This serves the same 41 handlers from one process,
// reached at /<name>, which is what supabase-js asks for once it is pointed
// here.
//
// One process rather than 41 services is a deliberate choice. The functions are
// small, they share nine helper modules, and 41 Cloud Run services would mean 41
// cold starts, 41 deployments and 41 sets of environment variables to keep in
// step. The cost of one process is that a crash in one handler restarts the lot
// - acceptable, because a handler that throws returns 500 rather than taking the
// process down.
//
// The functions themselves are unmodified apart from one import line: they call
// a serve() that records the handler instead of starting a server. See
// ../supabase/functions/_shared/serve.ts.

import { takeHandler, type Handler } from '../supabase/functions/_shared/serve.ts';
import { installStructuredConsole, withRequestContext } from '../supabase/functions/_shared/log.ts';
import { telemetryTarget } from '../supabase/functions/_shared/backend.ts';

/** Computed once: the env does not change while the process runs. */
const telemetry = telemetryTarget();

const PORT = Number(Deno.env.get('PORT') ?? 8080);
const ROOT = new URL('../supabase/functions/', import.meta.url);

/** Every function that exists, in no particular order. */
const SLUGS = [
  'ai-authorship', 'app-guide-chat', 'assign_tasks', 'create-college-user',
  'create-student-users', 'github-check', 'interests-analyze',
  'leetcode-streak-sync', 'level-open', 'level-quiz-submit', 'levels-place',
  'levels-warm', 'lot-writer', 'mock-interview-generate', 'mock-interview-score',
  'proof-file-url', 'question-generator', 
  'response-evaluator', 'resume-assessment-submit', 
  'resume-code-execute', 'resume-coding-generate', 'resume-improve',
  'resume-parser', 'resume-question-generator',
  'resume-retest-generate', 'run-code', 'run-sandbox', 'security-log',
  'scheduled-job', 'send-onboarding-email', 'submit-conceptual-answers', 'submit-sandbox-task',
  'submit-written-task', 'task-explain', 'trust-compute',
  'verify-proof', 'voice-score', 'client-log', 'transcription-enqueue', 'transcription-reap',
];

const handlers = new Map<string, Handler>();
const failed = new Map<string, string>();

/**
 * Load every function once, at startup.
 *
 * Deliberately not lazy. A function that fails to import should be discovered
 * when the service starts and can be rolled back, not at 2am when the first
 * student happens to trigger it.
 */
async function loadAll(): Promise<void> {
  for (const slug of SLUGS) {
    try {
      await import(new URL(`${slug}/index.ts`, ROOT).href);
      const handler = takeHandler();
      if (handler) handlers.set(slug, handler);
      else failed.set(slug, 'imported but registered no handler');
    } catch (err) {
      failed.set(slug, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`loaded ${handlers.size} of ${SLUGS.length} functions`);
  for (const [slug, why] of failed) console.error(`  FAILED ${slug}: ${why}`);
}

/**
 * Report readiness at /ready, not /healthz - Google's edge answers /healthz
 * with its own 404 page and the request never arrives here.
 */
function ready(): Response {
  return new Response(
    JSON.stringify({
      ok: failed.size === 0 && telemetry !== 'none',
      loaded: handlers.size,
      expected: SLUGS.length,
      failed: Object.fromEntries(failed),
      metadata: metadataStatus,
      // Where AI usage, rate limits and security events are written (F3). 'none'
      // means they would silently do nothing, so the service reports not-ready.
      telemetry,
    }),
    { status: failed.size === 0 && telemetry !== 'none' ? 200 : 503, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Can this service obtain a Google credential of its own?
 *
 * Recorded at startup because it decides whether the account-creating functions
 * can set an account's id. Without it, Identity Platform assigns its own id,
 * which is not a UUID and therefore cannot be stored in a database whose user
 * columns are uuid.
 */
let metadataStatus = 'not checked';

async function checkMetadata(): Promise<void> {
  const urls = [
    'http://metadata.google.internal/computeMetadata/v1/instance/service-account/default/token',
    'http://169.254.169.254/computeMetadata/v1/instance/service-account/default/token',
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } });
      if (res.ok) {
        await res.body?.cancel();
        metadataStatus = `available via ${new URL(url).host}`;
        return;
      }
      metadataStatus = `${new URL(url).host} answered ${res.status}`;
    } catch (err) {
      metadataStatus = `${new URL(url).host} threw ${err instanceof Error ? err.name : 'error'}`;
    }
  }
}

async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/ready') return ready();

  // Accept both /<name> and Supabase's /functions/v1/<name>, so a client that
  // has not been repointed yet still works during the changeover.
  const slug = url.pathname.replace(/^\/functions\/v1\//, '').replace(/^\//, '').split('/')[0];

  const handler = handlers.get(slug);
  if (!handler) {
    return new Response(JSON.stringify({ error: `no such function: ${slug}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    return await withRequestContext(slug, req, handler);
  } catch (err) {
    // One handler throwing must not take the other 40 down with it.
    console.error(`${slug} threw:`, err);
    return new Response(JSON.stringify({ error: 'internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) {
  installStructuredConsole();   // every console line becomes one JSON line with the request id
  await loadAll();
  await checkMetadata();
  console.log(`credentials: ${metadataStatus}`);
  console.log(`functions service listening on :${PORT}`);
  Deno.serve({ port: PORT }, router);
}

export { loadAll, router, handlers, failed, SLUGS };
