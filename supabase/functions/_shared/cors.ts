// CORS for every edge function.
//
// History, because it explains the shape:
//
// 1. All 38 functions carried `Access-Control-Allow-Origin: '*'` inline. A
//    wildcard lets any site on the internet call these from a visitor's
//    browser and read the reply - and most of them hold the service-role key,
//    which bypasses all 145 RLS policies.
// 2. That was replaced with one shared module pinned to a single origin. The
//    single origin then turned out to be the wrong one: prooflabai.com serves
//    a frozen Lovable build, while the live site deploys to
//    prooflaab.vercel.app. Every function still holding the old default
//    silently blocked the real browser.
// 3. Worse, the value lived in the code, so correcting it meant redeploying
//    all 41 functions together. A partial redeploy left them disagreeing -
//    which is exactly what happened.
//
// So: a LIST, read from the environment, matched against the caller.
//
// ALLOWED_ORIGINS is a comma-separated list. Set it once for the project:
//
//   supabase secrets set ALLOWED_ORIGINS="https://prooflaab.vercel.app,http://localhost:8080"
//
// Because it is read at runtime, changing it does not need a code change, and
// every function sees the same value no matter when it was last deployed.

const FALLBACK = 'https://prooflaab.vercel.app';

const ALLOWED: string[] = (
  Deno.env.get('ALLOWED_ORIGINS') ??
  Deno.env.get('ALLOWED_ORIGIN') ??   // the older single-value name
  FALLBACK
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Vercel preview builds get a generated hostname, so match the shape. */
const PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

function pickOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return ALLOWED[0] ?? FALLBACK;
  if (ALLOWED.includes(requestOrigin)) return requestOrigin;
  if (PREVIEW.test(requestOrigin)) return requestOrigin;
  // Not permitted: answer with our own origin, which the browser will refuse
  // to match, so the caller is blocked. Never echo an unknown origin.
  return ALLOWED[0] ?? FALLBACK;
}

/**
 * Headers for this specific request.
 *
 * Use it as the first line of a handler so it shadows the static export below:
 *
 *     serve(async (req) => {
 *       const corsHeaders = cors(req);
 *       ...
 *
 * Every `...corsHeaders` inside that handler then resolves to the local,
 * request-aware value, with no other edits.
 *
 * `Vary: Origin` matters: without it a CDN can cache the reply for one origin
 * and serve it to another, which silently breaks the second one.
 */
export function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': pickOrigin(req.headers.get('Origin')),
    // x-webhook-secret is listed for every function, not only the three that
    // read it. Naming a header here merely permits the browser to send it.
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-webhook-secret',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}

/**
 * Static fallback, for code that runs where no Request is in hand.
 *
 * Correct for the primary origin, wrong for localhost and previews - so prefer
 * `cors(req)` anywhere the request exists.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED[0] ?? FALLBACK,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Vary': 'Origin',
};
