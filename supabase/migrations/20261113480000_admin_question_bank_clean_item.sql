-- 480 (E2E S2, 12 Nov 2026): admin_question_bank replaces raw {item} template placeholders with <your resume item>.
-- Rollback: migration/480-rollback-admin-question-bank-clean-item.sql
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
               'id', q.id,
               'question', replace(q.question, '{item}', '<your resume item>'),
               'answer_notes', replace(q.answer_notes, '{item}', '<your resume item>'),
               'topic', replace(q.topic, '{item}', '<your resume item>'),
               'skill', q.skill, 'difficulty', q.difficulty, 'kind', q.kind, 'status', q.status,
               'created_at', q.created_at,
               'page_title', replace(sc.title, '{item}', '<your resume item>'),
               'page_url', sc.url)
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
  if position('replace(sc.title, ''{item}'', ''<your resume item>'')' in pg_get_functiondef('public.admin_question_bank(text,integer,timestamptz)'::regprocedure)) = 0 then
    raise exception '480 self-check failed';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
