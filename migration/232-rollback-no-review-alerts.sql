-- Rollback for 232: put the review alerts back and restore the digest writer.
begin;
insert into public.notifications select * from public.backup_review_digest_20261112 on conflict do nothing;
CREATE OR REPLACE FUNCTION public.notify_pending_reviews()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  today text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  pending integer;
  admins integer := 0;
  colleges integer := 0;
begin
  select count(*) into pending from public.task_submissions where status = 'needs_review';
  if pending = 0 then
    return jsonb_build_object('pending', 0, 'admins', 0, 'colleges', 0);
  end if;
  insert into public.notifications (user_id, type, title, message, link, source, audience, dedupe_key)
  select ur.user_id, 'review_digest', 'Answers waiting for review',
         pending || case when pending = 1 then ' answer is' else ' answers are' end || ' waiting in Work > Flags & reviews.',
         '/admin/dashboard?tab=reviewed-submissions', 'reviews', 'admin', 'review_digest:' || today
    from public.user_roles ur
   where ur.role = 'admin'
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics admins = row_count;
  insert into public.notifications (user_id, type, title, message, link, source, audience, dedupe_key)
  select c.user_id, 'review_digest', 'Answers waiting for review',
         x.n || case when x.n = 1 then ' answer from your students is' else ' answers from your students are' end
             || ' waiting. Open Students > Flagged Submissions.',
         '/college/dashboard?tab=students', 'reviews', 'college', 'review_digest:' || today
    from (select p.college_id, count(*)::integer as n
            from public.task_submissions s
            join public.student_profiles p on p.id = s.student_id
           where s.status = 'needs_review' and p.college_id is not null
           group by p.college_id) x
    join public.colleges c on c.id = x.college_id
   where c.user_id is not null and c.verification_status = 'approved' and c.status = 'active'
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics colleges = row_count;
  return jsonb_build_object('pending', pending, 'admins', admins, 'colleges', colleges);
end
$function$;
commit;
