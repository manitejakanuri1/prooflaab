-- 141: mock interview audio joins the "newest 7" rule of migration 138. Owner decision, 24 Oct 2026.
--
-- A student's task recordings and mock interview answers are counted together: the audio of the newest 7 is kept,
-- older audio is removed by the nightly prune-events job. The mock interview row, its words, score and feedback
-- stay for ever; each removed answer gets 'audio_purged_at' inside mock_interviews.answers.
-- voice_audio_to_purge() now also returns 'kind' ('voice' or 'mock'); the job marks voice rows with
-- mark_voice_audio_purged(ids) and mock answers with mark_mock_audio_purged(paths).
-- Release order on the REAL website: functions (new scheduled-job) first, then this migration.
-- Rollback: migration/141-rollback-mock-audio-in-newest-7.sql
begin;

drop function if exists public.voice_audio_to_purge(integer, integer);
create function public.voice_audio_to_purge(_keep integer default 7, _limit integer default 500)
returns table (id uuid, storage_path text, kind text)
language sql stable security definer set search_path = public, pg_temp as $$
  with rec as (
    select v.id, v.student_id, v.storage_path, v.created_at, v.withdrawn_at, 'voice'::text kind
      from public.voice_explanations v
     where v.storage_path is not null and v.audio_purged_at is null
    union all
    select m.id, m.student_id, a ->> 'storage_path', m.created_at + ((a ->> 'n')::int * interval '1 second'), null, 'mock'
      from public.mock_interviews m, jsonb_array_elements(m.answers) a
     where a ->> 'storage_path' is not null and a ->> 'audio_purged_at' is null
  )
  select q.id, q.storage_path, q.kind from (
    select r.*, row_number() over (partition by r.student_id, (r.withdrawn_at is null)
                                   order by r.created_at desc, r.storage_path) rn
      from rec r
  ) q
  where q.withdrawn_at is not null or q.rn > greatest(_keep, 1)
  order by q.id, q.storage_path
  limit least(greatest(_limit, 1), 1000);
$$;

create or replace function public.mark_mock_audio_purged(_paths text[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.mock_interviews m
     set answers = (select jsonb_agg(case when a ->> 'storage_path' = any(_paths) and a ->> 'audio_purged_at' is null
                                          then a || jsonb_build_object('audio_purged_at', now()) else a end
                                     order by o)
                      from jsonb_array_elements(m.answers) with ordinality x(a, o))
   where exists (select 1 from jsonb_array_elements(m.answers) a
                  where a ->> 'storage_path' = any(_paths) and a ->> 'audio_purged_at' is null);
  select count(*) into n from public.mock_interviews m, jsonb_array_elements(m.answers) a
   where a ->> 'storage_path' = any(_paths) and a ->> 'audio_purged_at' is not null;
  return n;
end $$;

revoke all on function public.voice_audio_to_purge(integer, integer) from public, anon, authenticated;
revoke all on function public.mark_mock_audio_purged(text[]) from public, anon, authenticated;
grant execute on function public.voice_audio_to_purge(integer, integer) to service_role;
grant execute on function public.mark_mock_audio_purged(text[]) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.voice_audio_to_purge(integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_mock_audio_purged(text[])', 'execute')
     or not has_function_privilege('service_role', 'public.mark_mock_audio_purged(text[])', 'execute')
     or position('mock_interviews' in pg_get_functiondef('public.voice_audio_to_purge(integer,integer)'::regprocedure)) = 0 then
    raise exception '141: not applied as written';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
