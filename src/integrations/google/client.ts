/**
 * The same client surface the app already imports, backed by Google.
 *
 * Three things are pointed somewhere new, and one deliberately is not:
 *
 *   auth      -> Google Identity Platform, via the shim in ./identity
 *   from/rpc  -> same-origin web BFF -> PostgREST -> Cloud SQL
 *   realtime  -> stubbed. Six screens subscribe to live database changes, which
 *                PostgREST cannot serve. Left alone, supabase-js retried the
 *                websocket forever - a console full of failures and a socket
 *                reconnecting on a loop behind every dashboard.
 *   storage   -> Cloud Storage, through the file service (phase 5)
 *   functions -> same-origin web BFF -> the Cloud Run function router
 *
 * Nothing is left behind now. The flag stays because it is the way back: one
 * variable returns the whole app to Supabase, which is worth keeping until the
 * new side has run in production for a while.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { googleAuth } from './identity';
import { googleStorage } from './storage';
import {
  rewriteBffUrl,
  sanitizeBffHeaders,
} from './bffTransport';

const APP_ORIGIN = window.location.origin;

/**
 * Keeps supabase-js in external-token mode so its own GoTrue client never owns
 * browser auth state. The value never leaves the browser: the BFF fetch wrappers
 * remove Authorization and apikey before every network request.
 */
const BFF_PLACEHOLDER_TOKEN = 'bff-cookie-session';

/**
 * supabase-js addresses tables at `<url>/rest/v1/<table>`, because that is where
 * Supabase's gateway puts PostgREST. Our PostgREST is the whole service, serving
 * from the root, so the prefix is taken back off on the way out. Rewriting one
 * path here is smaller and safer than teaching 133 call sites a new client.
 */
const restFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  const fixed = rewriteBffUrl(url, 'db', APP_ORIGIN);

  const headers = sanitizeBffHeaders(
    input instanceof Request ? input.headers : undefined,
    init?.headers,
  );

  const started = performance.now();

  const path = new URL(fixed).pathname
    .replace(/^\/api\/db\/?/, '');

  const target = path.startsWith('rpc/')
    ? path
    : path.split('/')[0];

  const done = (
    status: 'ok' | 'error',
    http?: number,
  ) =>
    observe({
      lane: 'rest',
      target,
      status,
      http,
      duration_ms: Math.round(performance.now() - started),
    });

  const requestInit: RequestInit = {
    ...init,
    headers,
    credentials: 'same-origin',
  };

  const call =
    typeof input === 'string' || input instanceof URL
      ? fetch(fixed, requestInit)
      : fetch(
          new Request(fixed, input),
          requestInit,
        );

  return call.then(
    (res) => {
      done(res.ok ? 'ok' : 'error', res.status);
      return res;
    },
    (err) => {
      done('error');
      throw err;
    },
  );
};

/**
 * Built on demand rather than at import time. A build that never turns Google on
 * must not construct a client from environment variables it was never given.
 */
/** One id per browser tab, kept for the tab's life. Falls back to a fresh id if storage is blocked. */
export const SESSION_ID = (() => {
  try {
    let id = sessionStorage.getItem("pl_session");
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("pl_session", id); }
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

/** Told about every call (function calls and table calls) so the step trail can record them. */
export interface CallInfo { lane: "function" | "rest"; target: string; status: "ok" | "error"; http?: number; duration_ms: number; request_id?: string }
let callObserver: ((c: CallInfo) => void) | null = null;
export const setCallObserver = (fn: ((c: CallInfo) => void) | null) => { callObserver = fn; };
const observe = (c: CallInfo) => { try { callObserver?.(c); } catch { /* never affects the call */ } };

/** fetch that adds x-request-id and x-session-id, and reports how the call ended. Adds no body, no personal data. */
const tracedFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  const fixed = rewriteBffUrl(
    url,
    'function',
    APP_ORIGIN,
  );

  const headers = sanitizeBffHeaders(
    input instanceof Request ? input.headers : undefined,
    init?.headers,
  );

  const requestId =
    headers.get('x-request-id') ??
    crypto.randomUUID();

  headers.set('x-request-id', requestId);
  headers.set('x-session-id', SESSION_ID);

  const target = new URL(fixed).pathname
    .replace(/^\/api\/functions\//, '')
    .split('/')[0];

  const started = performance.now();

  const requestInit: RequestInit = {
    ...init,
    headers,
    credentials: 'same-origin',
  };

  const call =
    typeof input === 'string' || input instanceof URL
      ? fetch(fixed, requestInit)
      : fetch(
          new Request(fixed, input),
          requestInit,
        );

  return call.then(
    (res) => {
      observe({
        lane: 'function',
        target,
        status: res.ok ? 'ok' : 'error',
        http: res.status,
        duration_ms: Math.round(
          performance.now() - started,
        ),
        request_id: requestId,
      });

      return res;
    },
    (err) => {
      observe({
        lane: 'function',
        target,
        status: 'error',
        duration_ms: Math.round(
          performance.now() - started,
        ),
        request_id: requestId,
      });

      throw err;
    },
  );
};

export function createGoogleClient() {
  const base = createClient<Database>(
    APP_ORIGIN,
    'bff-no-browser-api-key',
    {
      // Keep supabase-js out of the auth business. This fixed placeholder is
      // stripped by restFetch and never crosses the network.
      accessToken: async () => BFF_PLACEHOLDER_TOKEN,
      global: { fetch: restFetch },
      db: { schema: 'public' },
    },
  );

  // The 41 functions, now on Cloud Run. supabase-js calls them at
  // <url>/functions/v1/<name>, and the router accepts that path as well as the
  // bare /<name>, so nothing here needs rewriting. The same session token goes
  // with the call: the functions verify it against the secret they already hold.
  // Every call to a function carries a request id (one per call) and a session id (one per
  // browser tab), so one student action can be found in the server logs by searching that id.
  // The functions accept both headers (CORS) and write them into every log line.
  const functionsClient = createClient<Database>(
    APP_ORIGIN,
    'bff-no-browser-api-key',
    {
      // Same rule as database calls: supabase-js may construct an Authorization
      // header internally, but tracedFetch removes it before the request leaves
      // the page. The HttpOnly BFF cookie is the credential.
      accessToken: async () => BFF_PLACEHOLDER_TOKEN,
      global: { fetch: tracedFetch },
    },
  );

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
