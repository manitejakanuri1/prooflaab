-- STAGING ONLY, after migration 110. Owner decision 13 Oct 2026: staging accounts linked to a personal @gmail.com
-- mailbox keep their data and get NO automatic reconciliation (not marked, cut, restored, linked or recreated) until
-- their ownership is verified. Idempotent. Prints counts only, never an address.
-- Undo for one account (a person, with direct SQL): delete from public.identity_reconcile_hold where user_id = '<id>';
begin;
insert into public.identity_reconcile_hold (user_id, reason, held_by)
select ai.user_id, 'staging account linked to a personal mailbox; ownership not verified (owner decision 2026-10-13)',
       'owner via TEJA'
  from public.account_identities ai
  left join auth.users u on u.id = ai.user_id
 where lower(coalesce(ai.email, u.email)) like '%@gmail.com'
   and exists (select 1 from public.user_roles r where r.user_id = ai.user_id)
   and not exists (select 1 from public.protected_test_accounts t where t.user_id = ai.user_id)
on conflict (user_id) do nothing;

do $$
declare held int; open_rows int;
begin
  select count(*) into held from public.identity_reconcile_hold h
   where exists (select 1 from public.account_identities ai left join auth.users u on u.id = ai.user_id
                  where ai.user_id = h.user_id and lower(coalesce(ai.email, u.email)) like '%@gmail.com');
  select count(*) into open_rows from public.identity_lifecycle l
   where l.user_id in (select user_id from public.identity_reconcile_hold);
  raise notice 'HOLD: % gmail-linked account(s) on hold; % ledger row(s) for held accounts', held, open_rows;
  if open_rows > 0 then
    raise exception 'a held account already has a ledger row - review before continuing';
  end if;
end $$;
commit;
