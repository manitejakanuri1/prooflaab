/**
 * The same client surface the app already imports, backed by Google.
 *
 * Three things are pointed somewhere new, and one deliberately is not:
 *
 *   auth      -> Google Identity Platform, via the shim in ./identity
 *   from/rpc  -> PostgREST on Cloud Run, talking to Cloud SQL
 *   realtime  -> off. Nothing in the app subscribes to it.
 *   storage   -> Cloud Storage, through the file service (phase 5)
 *   functions -> still Supabase (phase 6 moves them)
 *
 * The one that stays behind is the reason this file reads a flag instead of
 * simply replacing the old client: with a Google session there is no Supabase
 * token, so the 24 edge functions that check one would start refusing callers.
 * Flipping the flag is therefore the last step of the move, not the first.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { googleAuth, currentAccessToken } from './identity';
import { googleStorage } from './storage';

const POSTGREST_URL = import.meta.env.VITE_POSTGREST_URL as string;

/**
 * supabase-js addresses tables at `<url>/rest/v1/<table>`, because that is where
 * Supabase's gateway puts PostgREST. Our PostgREST is the whole service, serving
 * from the root, so the prefix is taken back off on the way out. Rewriting one
 * path here is smaller and safer than teaching 133 call sites a new client.
 */
const restFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const fixed = url.replace(`${POSTGREST_URL}/rest/v1`, POSTGREST_URL);

  if (typeof input === 'string' || input instanceof URL) return fetch(fixed, init);
  return fetch(new Request(fixed, input), init);
};

/**
 * Built on demand rather than at import time. A build that never turns Google on
 * must not construct a client from environment variables it was never given.
 */
export function createGoogleClient() {
  const base = createClient<Database>(POSTGREST_URL, 'postgrest-needs-no-api-key', {
    // Supplying accessToken tells supabase-js that something else owns the
    // session. It then refuses every supabase.auth call - which is correct, and
    // is why the proxy below hands those to the shim instead.
    accessToken: async () => (await currentAccessToken()) ?? '',
    global: { fetch: restFetch },
    db: { schema: 'public' },
  });

  // Edge functions have not moved yet; they keep their old home.
  const legacy = createClient<Database>(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'auth') return googleAuth;
      if (prop === 'storage') return googleStorage;
      if (prop === 'functions') return legacy.functions;

      const value = Reflect.get(target, prop, receiver);
      // Methods must keep the real client as their `this`, or the query builder
      // loses its configuration.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as typeof base;
}
