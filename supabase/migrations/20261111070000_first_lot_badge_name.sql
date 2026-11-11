-- 225: the "Proven Once" badge is renamed (retest 11 Nov 2026, item 7). Since 223 it is given for the first
-- finished Lot (answer passed and voice done), so it says that. Slug and rule are unchanged.
-- Rollback: update public.badges set name = 'Proven Once',
--   description = 'Your first verified proof. Someone checked, and it held up.' where slug = 'first-proof';
begin;
update public.badges
   set name = 'First Lot finished',
       description = 'Your first Lot finished: the answer passed and the voice is done.'
 where slug = 'first-proof';
do $$
begin
  if exists (select 1 from public.badges where slug = 'first-proof' and name <> 'First Lot finished') then
    raise exception '225 self-check failed';
  end if;
end $$;
commit;
