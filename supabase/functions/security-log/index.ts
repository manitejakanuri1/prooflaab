import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { guard } from "../_shared/rate-limit.ts";
import { clientIp } from "../_shared/audit.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Events a browser is allowed to report.
 *
 * A closed list, not a free text field. Anything reaching this endpoint is
 * unauthenticated by necessity — a failed sign-in has no session to present —
 * so the only thing keeping the log readable is that the event name cannot be
 * chosen by the caller.
 */
const ALLOWED = new Set([
  'login_failed',
  'login_succeeded',
  'signup_failed',
  'password_reset_requested',
  'email_verification_resent',
]);

const SEVERITY: Record<string, 'info' | 'warning' | 'critical'> = {
  login_failed: 'warning',
  signup_failed: 'info',
  login_succeeded: 'info',
  password_reset_requested: 'warning',
  email_verification_resent: 'info',
};

/** Reasons the client may attribute a failure to. Anything else becomes 'other'. */
const REASONS = new Set(['invalid_credentials', 'email_not_confirmed', 'user_not_found', 'rate_limited', 'other']);

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[A-Za-z]{2,}$/;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Anyone can reach this endpoint, so it is the one most able to flood the log
  // it writes to. Capped well above what a real person types and well below
  // what would bury the useful entries.
  const limited = await guard(req, {
    bucket: 'security-log',
    limit: 40,
    windowSeconds: 3600,
    corsHeaders,
  });
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const eventType = String(body?.event_type ?? '');

    if (!ALLOWED.has(eventType)) {
      // Refused quietly. Telling a caller which names are accepted only helps
      // someone shaping forged entries.
      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Never trust an email the client supplies as identifying anyone; it is a
    // typed string, kept only so repeated attempts against one address show up.
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const email = EMAIL_RE.test(rawEmail) ? rawEmail : null;

    const rawReason = typeof body?.reason === 'string' ? body.reason : 'other';
    const reason = REASONS.has(rawReason) ? rawReason : 'other';

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    await fetch(`${url}/rest/v1/rpc/log_security_event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        p_event_type: eventType,
        p_severity: SEVERITY[eventType] ?? 'info',
        // Marked client so an admin reading the dashboard knows this entry was
        // volunteered by a browser and can be absent, not that it is complete.
        p_source: 'client',
        p_user_id: null,
        p_email: email,
        p_ip: clientIp(req),
        p_user_agent: req.headers.get('user-agent'),
        p_detail: { reason },
      }),
    });

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // A logging endpoint that returns an error teaches a caller when it worked.
    console.error('security-log failed:', error);
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
