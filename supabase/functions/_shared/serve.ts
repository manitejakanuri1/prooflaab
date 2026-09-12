// A stand-in for Deno's `serve`, so the same file works in both places.
//
// A Supabase edge function is a module that calls serve() at import time and
// owns the whole process. Cloud Run gives us one process for all 41, so they
// cannot each start a server.
//
// Rather than rewrite 41 files into a shape neither platform recognises, this
// module offers a serve() with the same signature that simply remembers the
// handler instead of listening. The router imports each function in turn and
// collects what it registered. On Supabase nothing changes: the real serve is
// still used there, because SUPABASE_URL is only set inside their runtime.
//
// The registration is deliberately single-slot rather than a map keyed by name:
// a function has no reliable way to know its own slug, and the router already
// knows which file it just imported.

export type Handler = (req: Request) => Response | Promise<Response>;

let pending: Handler | null = null;

/** What each function calls. Records the handler; starts nothing. */
export function serve(handler: Handler): void {
  pending = handler;
}

/** What the router calls, immediately after importing one function. */
export function takeHandler(): Handler | null {
  const handler = pending;
  pending = null;
  return handler;
}
