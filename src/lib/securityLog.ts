import { supabase } from "@/integrations/supabase/client";

/**
 * Reports an authentication event to the security log.
 *
 * These are the events no server-side code can see: Supabase Auth handles
 * sign-in itself, and a rejected password never reaches an edge function, so
 * the browser is the only place that knows it happened.
 *
 * That makes these reports advisory. Somebody driving the auth API directly
 * will not appear here — entries are stamped source='client' precisely so an
 * admin reading them knows that. They still catch the common real cases: a
 * student locked out of their own account, and someone guessing passwords
 * through the actual login form.
 */
export type AuthEvent =
  | 'login_failed'
  | 'login_succeeded'
  | 'signup_failed'
  | 'password_reset_requested'
  | 'email_verification_resent';

export type AuthFailureReason =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'user_not_found'
  | 'rate_limited'
  | 'other';

/** Turns a Supabase auth error into one of the reasons the log accepts. */
export function classifyAuthError(message?: string | null): AuthFailureReason {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'invalid_credentials';
  if (m.includes('email not confirmed') || m.includes('confirm your email')) return 'email_not_confirmed';
  if (m.includes('user not found')) return 'user_not_found';
  if (m.includes('rate limit') || m.includes('too many')) return 'rate_limited';
  return 'other';
}

/**
 * Fire and forget. Never awaited and never surfaced: a student who cannot sign
 * in should not also see an error about the logging of it.
 *
 * Only the address typed into the form is sent. The password is never included,
 * here or anywhere downstream.
 */
export function logAuthEvent(event: AuthEvent, email?: string, reason?: AuthFailureReason): void {
  void supabase.functions
    .invoke("security-log", { body: { event_type: event, email, reason } })
    .catch(() => {});
}
