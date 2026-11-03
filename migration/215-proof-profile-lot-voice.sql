-- 215 (owner OK 3 Nov 2026, TEST re-check of C9). Safe for REAL and TEST. Only adds two fields.
--   recruiter_proof_profile: each finished Lot in 'work' ("Lots solved" on the company's view of a profile)
--   now also carries kind ('code' | 'written') and voice_score (the student's authoritative, server-scored
--   explanation of that same task; null when there is none), so the screen can follow owner rule B
--   ("Passed" only with a voice of 50+). Nothing else in the function changes; grants are kept.
-- Rollback: migration/215-rollback-proof-profile-lot-voice.sql
begin;

create or replace function pg_temp.patch(_fn text, _old text, _new text) returns void language plpgsql as $p$
declare f record; def text; hits int := 0;
begin
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = _fn loop
    def := pg_get_functiondef(f.oid);
    if position(_old in def) > 0 then
      execute replace(def, _old, _new);
      hits := hits + 1;
    end if;
  end loop;
  if hits = 0 then raise exception '215: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

select pg_temp.patch('recruiter_proof_profile',
  $o$               t.title, t.difficulty
          from public.task_submissions s$o$,
  $n$               t.title, t.difficulty,
               case when t.sandbox_config_id is not null then 'code' else 'written' end as kind,
               (select ve.communication_score from public.voice_explanations ve
                 where ve.task_id = s.task_id and ve.student_id = s.student_id
                   and ve.transcript_source = 'server' and ve.status = 'scored'
                   and ve.current_authoritative and ve.withdrawn_at is null
                 order by ve.created_at desc limit 1) as voice_score
          from public.task_submissions s$n$);

do $$ begin
  if pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure) !~ 'as voice_score' then
    raise exception '215 self-check: recruiter_proof_profile not changed';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
