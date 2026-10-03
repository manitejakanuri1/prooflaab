import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";
import { writeLotTemplate } from "../_shared/lot-pipeline.ts";

/**
 * The student-facing fallback for writing a Lot. Normally the Lot behind a page is
 * already written by scheduled-job ?job=pregenerate-lots before anyone wakes up;
 * when a student reaches a page that is still on its seed version, this writes it
 * (once, for everybody) while they look at the seed card. Same pipeline either
 * way: _shared/lot-pipeline.ts.
 */

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Request-specific CORS on every reply, not only the preflight.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(
      authHeader.replace('Bearer ', ''),
    );
    if (claimsError || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const callerId = claims.claims.sub as string;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const sourceContentId: string | undefined =
      typeof body?.source_content_id === 'string' ? body.source_content_id : undefined;
    if (!sourceContentId) return json({ error: 'source_content_id is required' }, 400);

    const { data: roles } = await supabase
      .from('user_roles').select('role').eq('user_id', callerId);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin');

    // A student may only pay for content their own Lot is about. Without
    // this one account could walk the whole pool and spend the model budget
    // on content nobody has reached.
    if (!isAdmin) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: mine } = await supabase
        .from('tasks')
        .select('id')
        .eq('student_id', callerId)
        .eq('lot_date', today)
        .eq('source_content_id', sourceContentId)
        .maybeSingle();
      if (!mine) return json({ error: 'That is not your Lot for today.' }, 403);
    }

    const outcome = await writeLotTemplate(supabase, sourceContentId, callerId);
    if (!outcome.written) {
      if (outcome.status) return json({ error: outcome.reason }, outcome.status);
      return json({ ok: true, source_content_id: sourceContentId, written: false, reason: outcome.reason });
    }
    return json({ ok: true, source_content_id: sourceContentId, ...outcome });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
