-- 420 (P7c, 12 Nov 2026): Admin > AI usage. Some AI calls were saved with the login (user_id) but no
-- student_id, so they fell into the "unattributed" bucket although a student made them
-- (submit-written-task, task-explain). The view now finds the student from the login too.
-- Only the admin report changes; no AI, scoring or stored usage row is touched.
create or replace view public.llm_usage_by_student with (security_invoker = true) as
select coalesce(u.student_id, sp.id) as student_id,
       c.email,
       p.full_name,
       u.feature,
       u.provider,
       count(*) as calls,
       sum(u.prompt_tokens) as prompt_tokens,
       sum(u.completion_tokens) as completion_tokens,
       sum(u.total_tokens) as total_tokens,
       max(u.created_at) as last_used
  from llm_usage u
  left join student_profiles sp on u.student_id is null and sp.user_id = u.user_id
  left join student_profiles p on p.id = coalesce(u.student_id, sp.id)
  left join student_contact c on c.student_id = coalesce(u.student_id, sp.id)
 where is_admin()
 group by coalesce(u.student_id, sp.id), c.email, p.full_name, u.feature, u.provider;

do $$
begin
  if not exists (select 1 from pg_class where relname = 'llm_usage_by_student'
                 and reloptions @> array['security_invoker=true']) then
    raise exception '420: view lost security_invoker';
  end if;
  if (select count(*) from pg_attribute where attrelid = 'public.llm_usage_by_student'::regclass and attnum > 0) <> 10 then
    raise exception '420: view columns changed';
  end if;
end $$;

notify pgrst, 'reload schema';
