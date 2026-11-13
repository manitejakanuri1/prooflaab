-- 383 (owner yes, 13 Nov 2026): delete the 13 hidden "First Lot finished" badge rows that no longer
-- qualify under the done rule (migration 351 hides them). Backed up first. TEST only for now.
-- Rollback: migration/383-rollback-delete-hidden-first-lot-badges.sql
begin;
create table public.backup_20261113_hidden_badges as
with p as (
  select sb.student_id, (select count(distinct s.task_id) from public.task_submissions s
     where s.student_id = sb.student_id and s.status = 'passed'
       and exists (select 1 from public.voice_explanations dv where dv.task_id = s.task_id and dv.student_id = sb.student_id
                    and dv.status = 'scored' and dv.withdrawn_at is null)) as proofs
  from (select distinct student_id from public.student_badges) sb)
select sb.* from public.student_badges sb
  join public.badges b on b.slug = sb.badge_slug and b.rule_kind = 'proof'
  join p on p.student_id = sb.student_id
 where p.proofs < b.rule_value;
alter table public.backup_20261113_hidden_badges enable row level security;
revoke all on public.backup_20261113_hidden_badges from public, anon, authenticated;
delete from public.student_badges sb using public.backup_20261113_hidden_badges k
 where sb.student_id = k.student_id and sb.badge_slug = k.badge_slug;
do $$
declare n int; left_ int;
begin
  select count(*) into n from public.backup_20261113_hidden_badges;
  if n <> 13 then raise exception '383 self-check: expected 13 rows, found %', n; end if;
  select count(*) into left_ from public.student_badges sb join public.backup_20261113_hidden_badges k
    on k.student_id = sb.student_id and k.badge_slug = sb.badge_slug;
  if left_ <> 0 then raise exception '383 self-check: % rows still there', left_; end if;
  raise notice '383 self-check: true (13 backed up and deleted)';
end $$;
commit;
