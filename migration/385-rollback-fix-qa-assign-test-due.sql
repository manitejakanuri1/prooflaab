begin;
update public.tasks set due_date = '2026-11-16 00:00:00+05:30'
 where id in ('b84d96cd-bb80-4b94-bcb2-e828c187c94a', '4570ce8e-0e81-449c-93e3-19ae44663bc6');
commit;
