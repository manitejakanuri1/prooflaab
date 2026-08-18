-- ============================================================================
-- Found by testing, not by reading: both browser roles could TRUNCATE every
-- table in the schema.
--
-- Stage 1 restored the table grants with GRANT ALL, matching stock Supabase.
-- GRANT ALL includes TRUNCATE, REFERENCES and TRIGGER. TRUNCATE is the
-- dangerous one — it IGNORES row level security entirely, because policies
-- filter rows and truncate does not look at rows. No policy in this schema
-- would have stopped it. One statement, one empty table.
--
-- 30 tables were exposed this way, to `anon` as well as to `authenticated`.
--
-- Nothing reachable from a browser needs any of the three: PostgREST only ever
-- issues SELECT, INSERT, UPDATE, DELETE and function calls.
-- ============================================================================

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

-- And stop new tables being created with them.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- service_role keeps everything: it is the edge functions, and it already
-- bypasses row level security by design.
alter default privileges in schema public grant all on tables to postgres, service_role;
