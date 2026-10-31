-- Rollback of 196: puts the archived "Match played" rule rows back.
begin;
insert into public.squad_scoring_rules
select (jsonb_populate_record(null::public.squad_scoring_rules, a.row_data)).*
  from public.legacy_archive a
 where a.source_table = 'squad_scoring_rules' and a.row_data->>'metric' = 'match_participated'
on conflict do nothing;
commit;
