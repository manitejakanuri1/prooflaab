-- Rollback 420: the view as it was (student_id only).
create or replace view public.llm_usage_by_student with (security_invoker = true) as
select u.student_id, c.email, p.full_name, u.feature, u.provider, count(*) as calls,
       sum(u.prompt_tokens) as prompt_tokens, sum(u.completion_tokens) as completion_tokens,
       sum(u.total_tokens) as total_tokens, max(u.created_at) as last_used
  from llm_usage u
  left join student_profiles p on p.id = u.student_id
  left join student_contact c on c.student_id = u.student_id
 where is_admin()
 group by u.student_id, c.email, p.full_name, u.feature, u.provider;
notify pgrst, 'reload schema';
