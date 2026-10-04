-- Rollback of 81. WARNING: this re-opens the 35 SQL-internal functions to anyone through the API
-- (the unsafe state found on 4 Oct). Use only if 81 broke a legitimate flow, then re-apply a corrected 81.
begin;
do $$
declare s text;
begin
  foreach s in array array[
    'public.advance_season(uuid)', 'public.backfill_rounds(uuid)', 'public.claim_lot_template(uuid)', 'public.close_season(uuid)',
    'public.create_lot_for(uuid,date)', 'public.ensure_season(uuid)', 'public.extend_fixtures(uuid)', 'public.generate_championship(uuid)',
    'public.generate_cohort_league(uuid,boolean)', 'public.generate_final(uuid)', 'public.generate_knockout(uuid)',
    'public.generate_round_robin(uuid,boolean,integer)', 'public.has_role(uuid,app_role)', 'public.is_duplicate_source(text,text,bigint,real)',
    'public.log_activity(uuid,text,text,uuid,jsonb)', 'public.lot_needs_writer(uuid)', 'public.next_lot_source(uuid)',
    'public.notify_retest_unlocks()', 'public.plan_student_week(uuid,date)', 'public.prune_bug_finder_runs()', 'public.prune_rate_limits()',
    'public.qualify_squads(uuid)', 'public.record_activity(uuid,text)', 'public.recount_season(uuid)', 'public.refresh_unlock(uuid,text)',
    'public.reshuffle_quiz_options()', 'public.resolve_account_uuid(text,text)', 'public.run_squad_week(uuid,integer)',
    'public.schedule_round_robin(uuid,uuid[],integer,integer,text,text)', 'public.score_student_week(uuid,uuid,integer)',
    'public.seed_championship(uuid)', 'public.seed_lot_template(uuid)', 'public.settle_round(uuid,integer)',
    'public.suggest_tracks(uuid,integer)', 'public.write_audit(text,text,uuid,jsonb,jsonb,uuid)'] loop
    execute format('grant execute on function %s to public', s);
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
