// Shared CORS headers for every edge function.
//
// These used to be copy-pasted into 38 functions, all of them with
// `Access-Control-Allow-Origin: '*'`. A wildcard means any website on the
// internet can call these functions from a visitor's browser and read the
// reply, which matters here because most of these functions run with the
// service-role key and so bypass RLS entirely.
//
// One origin, one place to change it. Set ALLOWED_ORIGIN to override:
//   local dev      -> http://localhost:8080
//   staging/preview-> the preview URL
// Unset, it falls back to production.
//
// ponytail: single origin, not a per-request allowlist. Serving the app from
// exactly one hostname is what makes that safe, so www must redirect to the
// apex at the hosting layer rather than being a second allowed origin. If a
// genuine second browser origin ever appears, change corsHeaders into a
// function of the request that echoes a matching Origin and adds `Vary: Origin`.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://prooflaab.vercel.app';

// x-webhook-secret is listed for every function, not just the three that read
// it. Naming a header here only permits the browser to send it; it grants
// nothing on its own, and one list beats three near-identical ones.
export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Vary': 'Origin',
};
