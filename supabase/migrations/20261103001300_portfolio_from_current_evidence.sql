-- 63: the portfolio shows current evidence (Wave 8a).
-- The portfolio pages listed proof_uploads, which students stopped writing on 19 Sep,
-- so every portfolio was empty. portfolio_work() returns the Lots a student has PASSED
-- (latest passing attempt per Lot) with the score and the spoken-explanation score.
-- It returns no code and no answers - only what was proven and when.
-- Who may call it for a student: the student, an admin, or anyone signed in when that
-- student's portfolio is public (the same rule as the student_portfolios read policy).
begin;

create or replace function public.portfolio_work(_student_id uuid)
returns table (task_id uuid, title text, category text, kind text, language text,
               score integer, passed_count integer, total_count integer,
               passed_at timestamptz, explanation_score integer, set_by text)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select t.id, t.title, coalesce(t.lot_category, t.category),
         case when s.sandbox_config_id is not null then 'code' else 'written' end,
         s.language, s.sandbox_score, s.passed_count, s.total_count, s.created_at,
         (select v.communication_score from public.voice_explanations v
           where v.submission_id = s.id and v.status = 'scored' and v.withdrawn_at is null
           order by v.current_authoritative desc, v.created_at desc limit 1),
         (select st.name from public.startups st where st.user_id = t.sponsored_by)
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
   where s.student_id = _student_id
     and s.status = 'passed'
     and s.created_at = (select max(l.created_at) from public.task_submissions l
                          where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
     and (
          _student_id = (select auth.uid())
       or coalesce((select public.is_admin()), false)
       or exists (select 1 from public.student_portfolios p
                   where p.student_id = _student_id and p.is_public)
     )
   order by s.created_at desc
   limit 100;
$function$;

revoke all on function public.portfolio_work(uuid) from public, anon;
grant execute on function public.portfolio_work(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.portfolio_work(uuid)', 'execute') then
    raise exception '63 self-check: anon can read portfolio work';
  end if;
  if pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure) ~ 'proof_uploads|trust_score' then
    raise exception '63 self-check: portfolio_work reads a retired source';
  end if;
  -- No caller identity here: nothing private may come back.
  if exists (select 1 from public.student_profiles sp
              where not exists (select 1 from public.student_portfolios p where p.student_id = sp.id and p.is_public)
                and exists (select 1 from public.portfolio_work(sp.id))) then
    raise exception '63 self-check: a private portfolio returned work without a caller';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
