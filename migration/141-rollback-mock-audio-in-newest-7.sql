-- Rollback of 141: back to the migration 138 purge list (task recordings only). Mock audio already removed
-- does not come back; the 'audio_purged_at' marks inside mock_interviews.answers are kept.
begin;
drop function if exists public.voice_audio_to_purge(integer, integer);
create function public.voice_audio_to_purge(_keep integer default 7, _limit integer default 500)
returns table (id uuid, storage_path text)
language sql stable security definer set search_path = public, pg_temp as $$
  select q.id, q.storage_path from (
    select v.id, v.storage_path, v.withdrawn_at,
           row_number() over (partition by v.student_id, (v.withdrawn_at is null) order by v.created_at desc, v.id) rn
      from public.voice_explanations v
     where v.storage_path is not null and v.audio_purged_at is null
  ) q
  where q.withdrawn_at is not null or q.rn > greatest(_keep, 1)
  order by q.id
  limit least(greatest(_limit, 1), 1000);
$$;
revoke all on function public.voice_audio_to_purge(integer, integer) from public, anon, authenticated;
grant execute on function public.voice_audio_to_purge(integer, integer) to service_role;
drop function if exists public.mark_mock_audio_purged(text[]);
commit;
notify pgrst, 'reload schema';
