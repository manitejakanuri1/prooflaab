-- ROLLBACK 91: put back "score >= pass_threshold is enough" for coding submissions.
-- Submissions recorded while 91 was live keep the status they were given.
begin;
do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  old_rule constant text := E'  elsif _score >= pass_threshold then\n    v_status := ''passed'';';
  new_rule constant text := E'  elsif _score >= pass_threshold\n'
    || E'        and (_sandbox_config_id is null\n'
    || E'             or (_total_count > 0 and _passed_count = _total_count\n'
    || E'                 and jsonb_typeof(_details) = ''array'' and jsonb_array_length(_details) = _total_count\n'
    || E'                 and not exists (select 1 from jsonb_array_elements(_details) d\n'
    || E'                                  where (d ->> ''passed'') is distinct from ''true''))) then\n'
    || E'    v_status := ''passed'';';
  def text := pg_get_functiondef(f);
begin
  if position(new_rule in def) = 0 then return; end if;
  execute replace(def, new_rule, old_rule);
end $$;
commit;
