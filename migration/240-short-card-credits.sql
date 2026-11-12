-- 240 (owner 12 Nov 2026, TEST): the Option B "Read more" cards carried the whole course's source list.
--   Each card now shows one short line ("From the Python docs · PSF licence"); the full list stays in LICENSES.md.
--   Only the cards the trial added (source starts "ProofLab python course" / "ProofLab quant-aptitude course").
-- Rollback: re-run the trial (ProofLab_Courses_CLEAN/OPTION_B_TRIAL_rollback.sql, then its apply) - nothing else changes.
begin;
update public.level_content lc
   set read_more = (select jsonb_agg(case
            when e->>'source' like 'ProofLab python course%' then e || '{"source": "the Python docs", "licence": "PSF"}'
            when e->>'source' like 'ProofLab quant-aptitude course%' then e || '{"source": "Wikibooks: Arithmetic", "licence": "CC BY-SA 4.0"}'
            else e end order by n)
          from jsonb_array_elements(lc.read_more) with ordinality x(e, n))
 where jsonb_typeof(lc.read_more) = 'array'
   and exists (select 1 from jsonb_array_elements(lc.read_more) e where e->>'source' like 'ProofLab % course%');
do $$ begin
  if exists (select 1 from public.level_content lc, jsonb_array_elements(lc.read_more) e
              where jsonb_typeof(lc.read_more) = 'array' and e->>'source' like 'ProofLab % course%') then
    raise exception '240 self-check: a long course credit is left';
  end if;
end $$;
commit;
select 'CARDS '||count(*) from public.level_content lc, jsonb_array_elements(lc.read_more) e where jsonb_typeof(lc.read_more)='array' and e->>'source' in ('the Python docs','Wikibooks: Arithmetic');
