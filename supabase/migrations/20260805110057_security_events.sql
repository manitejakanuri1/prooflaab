-- Security event log.
--
-- Deliberately separate from audit_logs. That table records data changes and
-- requires table_name and a record id; a failed login changes no row and belongs
-- to no table, so putting it there would mean inventing values to satisfy the
-- schema.
--
-- The `source` column is the important one. Server-side entries are written by
-- edge functions holding the service key and cannot be forged or suppressed by a
-- client. Client-reported entries — failed sign-in above all — depend on the
-- browser choosing to report, so an attacker driving the auth API directly will
-- not appear. They still catch real user lockouts and unsophisticated attacks,
-- but an admin reading this must know which kind they are looking at.

CREATE TABLE IF NOT EXISTS public.security_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  source      text NOT NULL DEFAULT 'server' CHECK (source IN ('server', 'client')),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Kept even when user_id is null: a failed login against an address that does
  -- not exist is exactly the signal worth keeping, and it has no user to point at.
  email       text,
  ip          text,
  user_agent  text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_created_idx  ON public.security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_idx     ON public.security_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_email_idx    ON public.security_events (lower(email), created_at DESC);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Read: admins only. A log that its subject can read is a log an attacker reads
-- to learn what was noticed.
DROP POLICY IF EXISTS "Admins read security events" ON public.security_events;
CREATE POLICY "Admins read security events"
  ON public.security_events FOR SELECT
  USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policy at all: writes go through the function below,
-- which runs as owner, and nothing may edit or erase history through PostgREST.

CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type text,
  p_severity   text DEFAULT 'info',
  p_source     text DEFAULT 'server',
  p_user_id    uuid DEFAULT NULL,
  p_email      text DEFAULT NULL,
  p_ip         text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_detail     jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.security_events (
    event_type, severity, source, user_id, email, ip, user_agent, detail
  ) VALUES (
    left(p_event_type, 64),
    CASE WHEN p_severity IN ('info','warning','critical') THEN p_severity ELSE 'info' END,
    CASE WHEN p_source   IN ('server','client')           THEN p_source   ELSE 'client' END,
    p_user_id,
    left(p_email, 320),
    left(p_ip, 64),
    left(p_user_agent, 300),
    COALESCE(p_detail, '{}'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_security_event(text, text, text, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.log_security_event(text, text, text, uuid, text, text, text, jsonb) TO service_role;;
