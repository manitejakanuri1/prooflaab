// Security event logging for edge functions.
//
// Writes through backend.ts serviceRest, the same way logUsage and the rate
// limiter do, so a function does not need its own client just to record an event.

import { serviceRest, telemetryProblem } from './backend.ts';

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
      const res = await serviceRest('rpc/log_security_event', {
        method: 'POST',
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
        signal: AbortSignal.timeout(5000),
      });
      if (!res) telemetryProblem('security-events', 'no database configured');
      else if (!res.ok) telemetryProblem('security-events', `log_security_event answered ${res.status}`);
      else await res.body?.cancel();
    } catch (err) {
      telemetryProblem('security-events', `write failed: ${err instanceof Error ? err.message : err}`);
    }
  })();
}
