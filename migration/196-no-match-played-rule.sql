-- 196 (MF-100, owner 31 Oct 2026): the "Match played" scoring rule is removed.
--   Nothing ever records a match_participated activity (TEST: 0 such events ever), so the rule only showed a
--   points line that could never be earned. Daily Lot, voice, topic and active-day points are unchanged.
--   The rows are copied to legacy_archive first. Old screens keep a label for the event type, harmless.
-- Rollback: migration/196-rollback-no-match-played-rule.sql
begin;

insert into public.legacy_archive (source_table, row_data)
select 'squad_scoring_rules', to_jsonb(r) from public.squad_scoring_rules r where r.metric = 'match_participated';

delete from public.squad_scoring_rules where metric = 'match_participated';

do $$ begin
  if exists (select 1 from public.squad_scoring_rules where metric = 'match_participated') then
    raise exception '196 self-check: match_participated is still a scoring rule';
  end if;
end $$;

commit;
