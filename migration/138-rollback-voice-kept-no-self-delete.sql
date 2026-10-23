-- Rollback of 138. Audio already deleted by the daily job does not come back (Google keeps a deleted
-- file for 7 days only); audio_purged_at is kept so those rows still say so.
begin;
grant execute on function public.withdraw_voice_explanation(uuid) to authenticated;
grant delete on table public.voice_explanations to authenticated;
do $$
declare
  f   constant regprocedure := 'public.remove_students(uuid[],uuid,text)'::regprocedure;
  def text := pg_get_functiondef(f);
  a_old constant text := $a$if _reason = 'self' then
    raise exception 'students cannot delete their own account; ask your college or ProofLab admin';$a$;
  a_new constant text := $a$if _reason = 'self' and (_ids is null or _ids <> array[_by]) then
    raise exception 'you can delete only your own account';$a$;
begin
  if (length(def) - length(replace(def, a_old, ''))) / length(a_old) <> 1 then
    raise exception '138 rollback: remove_students is not the 138 version';
  end if;
  execute replace(def, a_old, a_new);
end $$;
drop function if exists public.voice_audio_to_purge(integer, integer);
drop function if exists public.mark_voice_audio_purged(uuid[]);
commit;
notify pgrst, 'reload schema';
