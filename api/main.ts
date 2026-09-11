// ProofLabAI API - the piece Supabase supplied as PostgREST and Google does not.
//
// Phase 3a: the skeleton plus one endpoint. The point of this step is not the
// endpoint, it is proving the shape:
//
//     request -> verify token -> SET LOCAL claims -> query -> RLS filters
//
// Once that is watertight for one table, the remaining 59 tables and 63 RPCs
// are the same pattern repeated, and each can be tested the same way.
//
// The rule this service obeys: it never decides what a caller may see. It only
// states who the caller is. Every filtering decision stays in the 145 policies
// that already exist and are already tested.
import { asUser } from './db.ts';
import { claimsFrom } from './auth.ts';

const PORT = Number(Deno.env.get('PORT') ?? 8080);

function json(body: unknown, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Reuses the decision made for the edge functions: echo a known origin,
      // never a wildcard, always Vary.
      'Access-Control-Allow-Origin': allowOrigin(origin),
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Vary': 'Origin',
    },
  });
}

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://prooflaab.vercel.app')
  .split(',').map((s) => s.trim()).filter(Boolean);
const PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

function allowOrigin(origin?: string | null): string {
  if (origin && (ALLOWED.includes(origin) || PREVIEW.test(origin))) return origin;
  return ALLOWED[0];
}

/** Postgres SQLSTATE 42501 - insufficient_privilege. */
function isPermissionDenied(err: unknown): boolean {
  const code = (err as { fields?: { code?: string }; code?: string })?.fields?.code
    ?? (err as { code?: string })?.code;
  return code === '42501';
}

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return json({}, 204, origin);

  // Liveness. Deliberately says nothing about the database or the caller.
  if (url.pathname === '/healthz') return json({ ok: true }, 200, origin);

  // ── the one endpoint ──────────────────────────────────────────────────────
  //
  // Equivalent to supabase.from('student_profiles').select(...) today. It takes
  // no filter arguments on purpose: there is nothing to filter by, because the
  // policies decide the rows. A caller cannot ask for someone else's row,
  // because asking is not how rows are chosen here.
  if (url.pathname === '/api/student_profiles' && req.method === 'GET') {
    const claims = await claimsFrom(req);
    try {
      const rows = await asUser(claims, async (c) => {
        const r = await c.queryObject<{
          id: string;
          full_name: string | null;
          college_id: string | null;
          total_xp: number | null;
        }>`
          select id, full_name, college_id, total_xp
            from public.student_profiles
           order by full_name
        `;
        return r.rows;
      });
      return json({ rows, count: rows.length }, 200, origin);
    } catch (err) {
      // Postgres 42501 is "insufficient privilege": the role has no grant on
      // the table at all. That is a refusal, not a fault, and answering 500
      // would misreport a working permission system as a broken server.
      //
      // Distinct from RLS filtering: a role WITH a grant but no matching policy
      // gets zero rows and a clean 200, because "you may look, and there is
      // nothing here for you" is a different statement from "you may not look".
      if (isPermissionDenied(err)) {
        return json(
          { error: claims ? 'Forbidden' : 'Authentication required' },
          claims ? 403 : 401,
          origin,
        );
      }
      // Everything else: detail to the log, never to the caller.
      console.error('GET /api/student_profiles failed:', err);
      return json({ error: 'Internal server error' }, 500, origin);
    }
  }

  return json({ error: 'Not found' }, 404, origin);
}

if (import.meta.main) {
  console.log(`api listening on :${PORT}`);
  Deno.serve({ port: PORT }, handler);
}

export { handler };
