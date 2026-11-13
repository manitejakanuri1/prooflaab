begin;
insert into public.student_badges select * from public.backup_20261113_hidden_badges on conflict do nothing;
commit;
