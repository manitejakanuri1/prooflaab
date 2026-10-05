-- ROLLBACK for 89: restore the pattern from migration 88 and re-tag.
update public.skill_vocab
   set pattern = '\mmachine learning\M|\mscikit|\msklearn\M|\mregression model\M|\mclassifier\M|\mtraining data\M'
 where skill = 'Machine Learning';
select public.sync_lot_candidate(lot_template_id) from public.lot_candidates where lot_template_id is not null;
do $$ begin
  if not 'Machine Learning' = any(public.tag_skills('a classifier')) then raise exception 'rollback 89 failed'; end if;
end $$;
