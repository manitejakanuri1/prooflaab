// Security event logging for edge functions.
//
// Writes through the service role, the same way logUsage and the rate limiter
// do, so a function does not need its own client just to record an event.

export type Severity = 'info' | 'warning' | 'critical';

export interface SecurityEvent {
  eventType: string;
  severity?: Severity;
  userId?: string | null;
  email?: string | null;
  detail?: Record<string, unknown>;
}

/** Reads the caller's address, preferring the proxy header the platform sets. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
}

/**
 * Records a security event. Never throws and is never awaited by the caller:
 * logging must not be able to fail — or slow down — the request it describes.
 */
export function logSecurityEvent(req: Request | null, event: SecurityEvent): void {
  void (async () => {
    try {
      const url = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !serviceKey) return;

      await fetch(`${url}/rest/v1/rpc/log_security_event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          p_event_type: event.eventType,
          p_severity: event.severity ?? 'info',
          p_source: 'server',
          p_user_id: event.userId ?? null,
          p_email: event.email ?? null,
          p_ip: req ? clientIp(req) : null,
          p_user_agent: req?.headers.get('user-agent') ?? null,
          p_detail: event.detail ?? {},
        }),
      });
    } catch (err) {
      console.error('Security event logging failed (ignored):', err);
    }
  })();
}
