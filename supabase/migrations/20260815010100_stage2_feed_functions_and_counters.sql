-- ============================================================================
-- Stage 2 — the two functions the feed calls, and the counters it reads.
-- ============================================================================

-- likes_count and comments_count live on proof_posts so the feed does not have
-- to count rows per post on every load. Triggers keep them true; nothing writes
-- them by hand. greatest(.. , 0) so a double delete can never drive a count
-- negative and leave "-1 likes" on screen.
create or replace function public.post_likes_bump()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.proof_posts set likes_count = likes_count + 1 where id = new.post_id;
    return new;
  else
    update public.proof_posts set likes_count = greatest(likes_count - 1, 0) where id = old.post_id;
    return old;
  end if;
end $$;

create or replace function public.post_comments_bump()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.proof_posts set comments_count = comments_count + 1 where id = new.post_id;
    return new;
  else
    update public.proof_posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
    return old;
  end if;
end $$;

create trigger post_likes_bump after insert or delete on public.post_likes
  for each row execute function public.post_likes_bump();
create trigger post_comments_bump after insert or delete on public.post_comments
  for each row execute function public.post_comments_bump();

-- StudentFeedPage calls these two by name with p_post_id.
--
-- Both are idempotent on purpose: liking twice is not an error and does not
-- double the count, and unliking something you never liked does nothing. A
-- double tap on a slow connection is an ordinary thing for a user to do, and it
-- must not corrupt the counter.
create or replace function public.like_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.post_likes (post_id, user_id)
  values (p_post_id, auth.uid())
  on conflict (post_id, user_id) do nothing;
end $$;

create or replace function public.unlike_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.post_likes where post_id = p_post_id and user_id = auth.uid();
end $$;

-- Postgres grants EXECUTE on every new function to PUBLIC, and revoking from
-- anon alone is a silent no-op on this project. Sweep all three, then re-grant
-- only the three the app actually calls. Re-run this sweep after adding any
-- function.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.like_post(uuid) to authenticated;
grant execute on function public.unlike_post(uuid) to authenticated;
