-- Counts a cache hit. SECURITY DEFINER and granted only to service_role, like
-- every other write in this system: the browser never reaches the cache at all.
CREATE OR REPLACE FUNCTION public.bump_llm_cache_hit(p_hash TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.llm_cache
     SET hits = hits + 1,
         last_used_at = now()
   WHERE prompt_hash = p_hash;
$$;

REVOKE ALL ON FUNCTION public.bump_llm_cache_hit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_llm_cache_hit(TEXT) TO service_role;;
