-- Rollback of 480: restore 147 definition of admin_question_bank
begin;

create or replace function public.admin_question_bank(_status text default 'draft', _limit integer default 50, _after timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'draft',    (select count(*) from public.question_bank where status = 'draft'),
      'approved', (select count(*) from public.question_bank where status = 'approved'),
      'hidden',   (select count(*) from public.question_bank where status = 'hidden'),
      'untagged', (select count(*) from public.question_bank where skill is null)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'question', q.question, 'answer_notes', q.answer_notes, 'topic', q.topic,
               'skill', q.skill, 'difficulty', q.difficulty, 'kind', q.kind, 'status', q.status,
               'created_at', q.created_at, 'page_title', sc.title, 'page_url', sc.url)
             order by q.created_at desc)
        from (select * from public.question_bank
               where (_status is null or status = _status)
                 and (_after is null or created_at < _after)
               order by created_at desc
               limit greatest(1, least(coalesce(_limit, 50), 200))) q
        join public.source_content sc on sc.id = q.source_content_id), '[]'::jsonb));
end $fn$;

do $$
begin
  if position('replace(sc.title' in pg_get_functiondef('public.admin_question_bank(text,integer,timestamptz)'::regprocedure)) > 0 then
    raise exception '480 rollback self-check failed';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
