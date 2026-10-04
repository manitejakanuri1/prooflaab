-- Rollback of 80. WARNING: this restores the unsafe state (anyone could run these through the API,
-- including record_task_submission). Use only if 80 broke a legitimate flow, then re-apply a corrected 80.
begin;
do $$
declare s text;
begin
  foreach s in array array[
    'public.account_id_for_email(text)', 'public.bump_llm_cache_hit(text)', 'public.check_rate_limit(text,text,integer,integer)',
    'public.drop_empty_account(uuid)', 'public.ensure_and_claim_lot_template(uuid)', 'public.extend_all_fixtures()',
    'public.form_all_colleges()', 'public.form_squads(uuid,uuid)', 'public.log_security_event(text,text,text,uuid,text,text,text,jsonb)',
    'public.notify_weekly_progress()', 'public.plan_all_weeks()', 'public.prune_app_events()', 'public.record_account(text,text,text,boolean)',
    'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])',
    'public.record_topic_attempt(uuid,text,text,uuid,integer)', 'public.release_lot_template(uuid,uuid)', 'public.remove_students(uuid[],uuid,text)',
    'public.resolve_account(text,text,boolean)', 'public.run_all_seasons()',
    'public.save_lot_template(uuid,uuid,text,text,text,text,text,integer,text)',
    'public.save_lot_template(uuid,uuid,text,text,text,text,text,integer,text,uuid,uuid)',
    'public.similar_written_submission(uuid,uuid,text,real)', 'public.student_logins()', 'public.touch_lot_template(uuid,uuid)',
    'public.touch_streak(uuid)', 'public.touch_template(text)'] loop
    execute format('grant execute on function %s to public', s);
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
