import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { ensureTopicSteps, type LevelRow } from "../_shared/levels.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";

/**
 * Write level content ahead of time, so no student is the one who waits.
 *
 * Content is generated on first open and cached forever after, which means the
 * very first student to reach any given level pays a ten-second wait and sees
 * "writing this level". That is a bad first impression for a feature whose whole
 * pitch is momentum, and it lands hardest on the levels everybody starts at.
 * Running this over the opening levels of every track means the cold path is
 * only ever hit deep into a track, by someone already invested.
 *
 * Admin only. It spends real money with the model provider on every call.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsStatic, 'Content-Type': 'application/json' },
  });

/**
 * Levels written per call.
 *
 * Small on purpose. Each level is one model call taking the better part of ten
 * seconds, and a run of thirty-six in a single invocation blew straight through
 * the edge runtime's wall-clock limit and returned WORKER_RESOURCE_LIMIT with
 * nothing to show for the time it did spend. The caller loops instead: every
 * call is idempotent and reports what is left, so "keep calling until remaining
 * is 0" finishes the job without any one request living dangerously long.
 */
const DEFAULT_BATCH = 4;
const MAX_BATCH = 8;

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', callerId);
    if (!(roles ?? []).some((r: any) => r.role === 'admin')) {
      return json({ error: 'Forbidden' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const upTo = Number.isInteger(body?.up_to_level) ? Math.max(1, body.up_to_level) : 3;
    const trackSlug: string | undefined =
      typeof body?.track_slug === 'string' ? body.track_slug : undefined;
    const batchSize = Number.isInteger(body?.batch)
      ? Math.min(MAX_BATCH, Math.max(1, body.batch))
      : DEFAULT_BATCH;

    // Only seed rows (sub_level=1) — a topic is regenerated as a whole, and
    // ensureTopicSteps expects the seed row, not one of its expanded steps.
    let query = supabase
      .from('levels')
      .select('id, track_slug, level_number, sub_level, kind, skill, title')
      .eq('sub_level', 1)
      .lte('level_number', upTo)
      .order('track_slug')
      .order('level_number');
    if (trackSlug) query = query.eq('track_slug', trackSlug);

    const { data: levels } = await query;

    // Skip anything already expanded into sub-steps — this endpoint is meant
    // to be safe to run again after a partial failure without paying for the
    // same topic twice. NOT the same as "has level_content": a topic that
    // still has its old single-blob content (pre-sub-stepping) has a row in
    // level_content already but is still exactly 1 row in `levels`, so it
    // needs regenerating same as one that has never been opened at all.
    const { data: allRows } = await supabase
      .from('levels')
      .select('track_slug, level_number');
    const rowCountByTopic = new Map<string, number>();
    for (const r of (allRows ?? []) as { track_slug: string; level_number: number }[]) {
      const key = `${r.track_slug}:${r.level_number}`;
      rowCountByTopic.set(key, (rowCountByTopic.get(key) ?? 0) + 1);
    }
    const written = new Set(
      (levels ?? [])
        .filter((l: any) => (rowCountByTopic.get(`${l.track_slug}:${l.level_number}`) ?? 1) > 1)
        .map((l: any) => l.id),
    );

    const pending = (levels ?? []).filter((l: any) => !written.has(l.id));
    const batch = pending.slice(0, batchSize);

    const generated: string[] = [];
    const failed: { level: string; reason: string }[] = [];

    for (const level of batch) {
      try {
        const { levels: steps } = await ensureTopicSteps(supabase, level as LevelRow, {
          userId: callerId,
          skipRateLimit: true,
        });
        const stepCount = steps.filter((s) => s.kind === 'explanation').length;
        generated.push(`${level.track_slug} L${level.level_number} — ${level.skill} (${stepCount} steps)`);
      } catch (err) {
        // One bad level must not abandon the other thirty-five. Failures are
        // reported so they can be retried, and the level still generates on
        // first open exactly as it would have without this job.
        failed.push({
          level: `${level.track_slug} L${level.level_number}`,
          reason: (err as Error).message,
        });
      }
    }

    return json({
      requested_up_to: upTo,
      already_written: written.size,
      generated: generated.length,
      failed: failed.length,
      remaining: Math.max(0, pending.length - batch.length),
      details: { generated, failed },
    });
  } catch (error) {
    console.error('Error in levels-warm:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
