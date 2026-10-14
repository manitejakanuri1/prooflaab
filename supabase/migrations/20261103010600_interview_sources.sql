-- 116: Active curated interview sources for the crawler (2025-2026 DSA and system design).
--
-- Adds top permissive, MIT/Apache licensed repositories with active 2025-2026 problem sets
-- to public.source_registry. The crawler (crawler/crawl.py) picks up these active rows
-- on its next scheduled run, dedupes against existing questions, and stores new candidates.
--
-- Rollback: 116-rollback-interview-sources.sql
begin;

insert into public.source_registry (
  domain,
  name,
  seed_urls,
  path_scope,
  rights_flag,
  known_dynamic,
  rate_limit_per_min,
  max_depth,
  license_note
)
values
  (
    'github.com/yangshun/tech-interview-handbook',
    'Tech Interview Handbook (Algorithms & Company Rounds)',
    array['https://github.com/yangshun/tech-interview-handbook'],
    array['/contents/'],
    'APPROVED_SOURCE',
    false,
    20,
    2,
    'MIT License: permissive reuse for coding tasks and interview prep.'
  ),
  (
    'github.com/donnemartin/system-design-primer',
    'System Design Primer (Architecture & Design Problems)',
    array['https://github.com/donnemartin/system-design-primer'],
    array['/solutions/'],
    'APPROVED_SOURCE',
    false,
    20,
    2,
    'Open source / MIT: real company system design challenges and architectures.'
  ),
  (
    'github.com/kdn251/interviews',
    'Curated Top Tech Interview Questions (DSA & Core CS)',
    array['https://github.com/kdn251/interviews'],
    array['/company-questions/'],
    'APPROVED_SOURCE',
    false,
    20,
    2,
    'MIT License: curated company problems for software engineering roles.'
  )
on conflict (domain) do update set
  seed_urls = excluded.seed_urls,
  path_scope = excluded.path_scope,
  rights_flag = excluded.rights_flag,
  retired_at = null,
  updated_at = now();

do $$
begin
  if (select count(*) from public.source_registry where domain in (
    'github.com/yangshun/tech-interview-handbook',
    'github.com/donnemartin/system-design-primer',
    'github.com/kdn251/interviews'
  ) and rights_flag = 'APPROVED_SOURCE' and retired_at is null) <> 3 then
    raise exception '116 self-check: curated interview sources were not registered';
  end if;
end $$;

commit;
