begin;

drop index if exists public.web_sessions_one_unrevoked_per_user;

drop function if exists public.web_replace_session(
  text, uuid, text, timestamptz, timestamptz
);

drop function if exists public.web_login_identity(uuid);

commit;

notify pgrst, 'reload schema';
