/**
 * The same client surface the app already imports, backed by Google.
 *
 * Three things are pointed somewhere new, and one deliberately is not:
 *
 *   auth      -> Google Identity Platform, via the shim in ./identity
 *   from/rpc  -> PostgREST on Cloud Run, talking to Cloud SQL
 *   realtime  -> stubbed. Six screens subscribe to live database changes, which
 *                PostgREST cannot serve. Left alone, supabase-js retried the
 *                websocket forever - a console full of failures and a socket
 *                reconnecting on a loop behind every dashboard.
 *   storage   -> Cloud Storage, through the file service (phase 5)
 *   functions -> the 41 functions on Cloud Run (phase 6)
 *
 * Nothing is left behind now. The flag stays because it is the way back: one
 * variable returns the whole app to Supabase, which is worth keeping until the
 * new side has run in production for a while.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { googleAuth, currentAccessToken } from './identity';
import { googleStorage } from './storage';

const POSTGREST_URL = import.meta.env.VITE_POSTGREST_URL as string;
const FUNCTIONS_URL = import.meta.env.VITE_FUNCTIONS_URL as string;

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

  // The 41 functions, now on Cloud Run. supabase-js calls them at
  // <url>/functions/v1/<name>, and the router accepts that path as well as the
  // bare /<name>, so nothing here needs rewriting. The same session token goes
  // with the call: the functions verify it against the secret they already hold.
  const functionsClient = createClient<Database>(FUNCTIONS_URL, 'functions-need-no-api-key', {
    accessToken: async () => (await currentAccessToken()) ?? '',
    global: { fetch },
  });

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'auth') return googleAuth;

      // A channel that connects to nothing. Supabase's Realtime is a separate
      // server; PostgREST has no equivalent, so every subscription failed and
      // reconnected in a loop.
      //
      // Subscribing quietly does nothing rather than throwing, because the six
      // callers use it to refresh a list that a periodic refetch also refreshes
      // - see useLiveRefresh. A throw here would break screens that otherwise
      // work perfectly.
      if (prop === 'channel') {
        return () => {
          const chain = {
            on: () => chain,
            subscribe: (cb?: (status: string) => void) => {
              cb?.('SUBSCRIBED');
              return chain;
            },
            unsubscribe: async () => 'ok' as const,
          };
          return chain;
        };
      }
      if (prop === 'removeChannel' || prop === 'removeAllChannels') {
        return async () => 'ok' as const;
      }
      if (prop === 'getChannels') return () => [];
      if (prop === 'storage') return googleStorage;
      if (prop === 'functions') return functionsClient.functions;

      const value = Reflect.get(target, prop, receiver);
      // Methods must keep the real client as their `this`, or the query builder
      // loses its configuration.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as typeof base;
}
