-- 541 (A6 UI, 13 Nov 2026): Admin Question bank showed only the newest 100 of 868 and had no search.
-- admin_question_bank(_after timestamptz) can't page safely: up to 8 questions share one created_at (cut from
-- one page in one insert), so "created_at < last" skips the rest of a tie. New admin-only reader with search and
-- a (created_at, id) cursor; it returns the same counts plus 'matching' (rows for this status + search).
-- admin_question_bank is left as it is.
begin;
create or replace function public.admin_question_bank_page(
  _status text default 'approved', _q text default null, _limit integer default 100,
  _after_ts timestamptz default null, _after_id uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare pat text := '%' || replace(replace(replace(nullif(btrim(_q), ''), '\', '\'), '%', '\%'), '_', '\_') || '%';
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'draft',    (select count(*) from public.question_bank where status = 'draft'),
      'approved', (select count(*) from public.question_bank where status = 'approved'),
      'hidden',   (select count(*) from public.question_bank where status = 'hidden'),
      'untagged', (select count(*) from public.question_bank where skill is null),
      'matching', (select count(*) from public.question_bank q
                    where (_status is null or q.status = _status)
                      and (pat is null or q.question ilike pat or q.topic ilike pat or q.skill ilike pat))),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'question', q.question, 'answer_notes', q.answer_notes, 'topic', q.topic,
               'skill', q.skill, 'difficulty', q.difficulty, 'kind', q.kind, 'status', q.status,
               'created_at', q.created_at, 'page_title', sc.title, 'page_url', sc.url)
             order by q.created_at desc, q.id desc)
        from (select * from public.question_bank q
               where (_status is null or q.status = _status)
                 and (pat is null or q.question ilike pat or q.topic ilike pat or q.skill ilike pat)
                 and (_after_ts is null or (q.created_at, q.id) < (_after_ts, coalesce(_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
               order by q.created_at desc, q.id desc
               limit greatest(1, least(coalesce(_limit, 100), 200))) q
        left join public.source_content sc on sc.id = q.source_content_id), '[]'::jsonb));
end $function$;
revoke all on function public.admin_question_bank_page(text, text, integer, timestamptz, uuid) from public, anon;
grant execute on function public.admin_question_bank_page(text, text, integer, timestamptz, uuid) to authenticated, service_role;
do $$
declare n int;
begin
  if to_regprocedure('public.admin_question_bank_page(text,text,integer,timestamptz,uuid)') is null then
    raise exception '541 self-check: function missing'; end if;
  if has_function_privilege('anon', 'public.admin_question_bank_page(text,text,integer,timestamptz,uuid)', 'execute') then
    raise exception '541 self-check: anon can run it'; end if;
  raise notice '541 self-check: true';
end $$;
commit;
notify pgrst, 'reload schema';
