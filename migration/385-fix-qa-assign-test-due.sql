-- 385 (owner yes 13 Nov): the two "QA assign test" tasks were saved before the N2 date fix as
-- 16 Nov 00:00 IST (meant: 15 Nov). Set them to 15 Nov 23:59:59 IST, like every other due date now.
-- Rollback: migration/385-rollback-fix-qa-assign-test-due.sql (puts back 16 Nov 00:00 IST).
begin;
update public.tasks set due_date = '2026-11-15 23:59:59+05:30'
 where id in ('b84d96cd-bb80-4b94-bcb2-e828c187c94a', '4570ce8e-0e81-449c-93e3-19ae44663bc6')
   and due_date = '2026-11-16 00:00:00+05:30';
do $$ begin
  if (select count(*) from public.tasks where id in ('b84d96cd-bb80-4b94-bcb2-e828c187c94a', '4570ce8e-0e81-449c-93e3-19ae44663bc6')
        and due_date = '2026-11-15 23:59:59+05:30') <> 2 then raise exception '385 self-check failed'; end if;
  raise notice '385 self-check: true';
end $$;
commit;
