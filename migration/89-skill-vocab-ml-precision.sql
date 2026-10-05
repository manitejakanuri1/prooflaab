-- 89: "classifier" alone tagged an if/elif grade classifier as Machine Learning (seen on staging after 88).
-- Machine Learning now needs ML wording (machine learning, scikit/sklearn, training a model, model accuracy...).
-- Data only: one vocabulary row, then every candidate is re-tagged from its template.
update public.skill_vocab
   set pattern = '\mmachine learning\M|\mscikit|\msklearn\M|\mregression model\M|\mtrain(ing|ed)? (a |the )?(model|classifier)\M|\mtraining data\M|\mmodel accuracy\M|\mneural network\M'
 where skill = 'Machine Learning';
select public.sync_lot_candidate(lot_template_id) from public.lot_candidates where lot_template_id is not null;
do $$ begin
  if 'Machine Learning' = any(public.tag_skills('Grade Classifier with if-elif-else')) then raise exception '89: still a false positive'; end if;
  if not 'Machine Learning' = any(public.tag_skills('Train a classifier with scikit-learn')) then raise exception '89: lost a true positive'; end if;
end $$;
