-- ROLLBACK for 129: restore JavaScript's pattern from migration 88, remove Aptitude, re-tag.
update public.skill_vocab set pattern = '\mjavascript\M|\mnode\.?js\M|\mnpm\M' where skill = 'JavaScript';
delete from public.skill_vocab where skill = 'Aptitude';
select public.sync_lot_candidate(lot_template_id) from public.lot_candidates where lot_template_id is not null;
do $$ begin
  if 'Aptitude' in (select skill from public.skill_vocab) then raise exception 'rollback 129 failed'; end if;
end $$;
