-- ROLLBACK 93: back to 91's "one stored row per test" length rule.
-- WARNING: with functions 444b2f3 or later (hidden tests stored as one summary row) this makes every
-- correct coding submission with 2+ hidden tests 'failed' again. Roll back only together with a
-- functions image whose redact() stores one row per test.
-- Submissions recorded while 93 was live keep the status they were given.
begin;
do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  old_rule constant text := E'                 and jsonb_typeof(_details) = ''array'' and jsonb_array_length(_details) = _total_count\n';
  new_rule constant text := E'                 and jsonb_typeof(_details) = ''array''\n'
    || E'                 and (select coalesce(sum(case when d ->> ''id'' = ''hidden-summary'' and jsonb_typeof(d -> ''hidden_count'') = ''number''\n'
    || E'                                               then (d ->> ''hidden_count'')::numeric else 1 end), 0)\n'
    || E'                        from jsonb_array_elements(_details) d) = _total_count\n';
  def text := pg_get_functiondef(f);
begin
  if position(new_rule in def) = 0 then return; end if;
  execute replace(def, new_rule, old_rule);
end $$;
commit;
