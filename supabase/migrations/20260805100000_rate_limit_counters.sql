-- Rate limiting primitive.
--
-- Fixed-window counters: one row per (bucket, subject, window). Fixed windows
-- allow a burst across a window boundary, but they are atomic in a single
-- statement and cost one round trip, which matters when the check sits in front
-- of every AI call. A sliding window would need a row per hit.
--
-- Counting lives in the database because edge functions run as many short-lived
-- isolates: an in-process counter resets constantly and caps nothing.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket       text        NOT NULL,
  subject      text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, subject, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_window_idx
  ON public.rate_limit_counters (window_start);

-- No policies: nobody reaches this table through PostgREST. Only the function
-- below touches it, and that runs as owner.
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket         text,
  p_subject        text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_hits         integer;
  v_reset_at     timestamptz;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'check_rate_limit: limit and window must be positive';
  END IF;

  -- Snap to the start of the current window so every caller in the same window
  -- lands on the same row.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );
  v_reset_at := v_window_start + make_interval(secs => p_window_seconds);

  INSERT INTO public.rate_limit_counters AS c (bucket, subject, window_start, hits)
  VALUES (p_bucket, p_subject, v_window_start, 1)
  ON CONFLICT (bucket, subject, window_start)
  DO UPDATE SET hits = c.hits + 1
  RETURNING c.hits INTO v_hits;

  -- Cheap opportunistic cleanup; old windows can never be read again.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN jsonb_build_object(
    'allowed',     v_hits <= p_limit,
    'hits',        v_hits,
    'limit',       p_limit,
    'remaining',   greatest(0, p_limit - v_hits),
    'reset_at',    v_reset_at,
    'retry_after', greatest(1, ceil(extract(epoch FROM (v_reset_at - now())))::integer)
  );
END;
$$;

-- Callable only by the service role: edge functions decide the limit, so a
-- client that could call this directly could also choose its own limit.
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;
