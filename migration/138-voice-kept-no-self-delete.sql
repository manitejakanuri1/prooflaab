-- 138: students can no longer delete their recordings or their account; old audio is cleaned up instead.
-- Owner decision, 23 Oct 2026.
--
--   1. A student cannot withdraw (delete) a voice recording: withdraw_voice_explanation() is taken away from
--      signed-in users, and the leftover table-level DELETE grant goes too (there was no delete policy since 61).
--      The files service refuses DELETE on voice files for everyone (files-service/main.ts).
--   2. A student cannot delete their own account: remove_students() refuses the reason 'self'. A college or an
--      administrator can still remove a student (reasons 'college' / 'admin' are unchanged).
--   3. Storage: each student keeps the audio of their NEWEST 7 recordings. Older audio (and the audio of any
--      withdrawn recording) is deleted by the daily prune job (scheduled-job prune-events, 03:10 IST), which
--      lists files with voice_audio_to_purge() and records each deletion with mark_voice_audio_purged().
--      The row, transcript and score are kept for ever; only the audio file goes. audio_purged_at says when.
-- Rollback: migration/138-rollback-voice-kept-no-self-delete.sql
begin;

-- ── 1. no deleting a recording ──────────────────────────────────────────────
revoke execute on function public.withdraw_voice_explanation(uuid) from authenticated;
revoke delete on table public.voice_explanations from authenticated;

-- ── 2. no deleting your own account ─────────────────────────────────────────
do $$
declare
  f   constant regprocedure := 'public.remove_students(uuid[],uuid,text)'::regprocedure;
  def text := pg_get_functiondef(f);
  a_old constant text := $a$if _reason = 'self' and (_ids is null or _ids <> array[_by]) then
    raise exception 'you can delete only your own account';$a$;
  a_new constant text := $a$if _reason = 'self' then
    raise exception 'students cannot delete their own account; ask your college or ProofLab admin';$a$;
begin
  if (length(def) - length(replace(def, a_old, ''))) / length(a_old) <> 1 then
    raise exception '138: remove_students is not the version this migration expects (105)';
  end if;
  execute replace(def, a_old, a_new);
end $$;

-- ── 3. keep the newest 7 recordings' audio ──────────────────────────────────
alter table public.voice_explanations add column if not exists audio_purged_at timestamptz;

-- Audio to delete: withdrawn recordings, and everything after a student's newest 7 (by when it was recorded).
create or replace function public.voice_audio_to_purge(_keep integer default 7, _limit integer default 500)
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

create or replace function public.mark_voice_audio_purged(_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; prev text := coalesce(current_setting('app.system_write', true), '');
begin
  perform set_config('app.system_write', 'on', true);
  update public.voice_explanations set audio_purged_at = now()
   where id = any(_ids) and audio_purged_at is null;
  get diagnostics n = row_count;
  perform set_config('app.system_write', prev, true);
  return n;
end $$;

revoke all on function public.voice_audio_to_purge(integer, integer) from public, anon, authenticated;
revoke all on function public.mark_voice_audio_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.voice_audio_to_purge(integer, integer) to service_role;
grant execute on function public.mark_voice_audio_purged(uuid[]) to service_role;

-- ── self-check ──────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.withdraw_voice_explanation(uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.voice_explanations', 'delete') then
    raise exception '138: students can still delete a recording';
  end if;
  if position('students cannot delete their own account' in
              pg_get_functiondef('public.remove_students(uuid[],uuid,text)'::regprocedure)) = 0 then
    raise exception '138: self account delete is still allowed';
  end if;
  if has_function_privilege('authenticated', 'public.voice_audio_to_purge(integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_voice_audio_purged(uuid[])', 'execute')
     or not has_function_privilege('service_role', 'public.mark_voice_audio_purged(uuid[])', 'execute') then
    raise exception '138: purge functions have the wrong grants';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
