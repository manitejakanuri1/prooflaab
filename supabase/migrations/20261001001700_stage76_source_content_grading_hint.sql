-- stage76: a real grading-mode signal on source_content, not just a keyword guess
--
-- lot-writer picks sandbox vs rubric with a regex over the content's own
-- title/excerpt (see the "ponytail" comment there) because there was nowhere
-- else to read a real signal from. That is a genuine simplification with a
-- named ceiling, and its own comment says the upgrade path: tag
-- source_content with a real category instead of sniffing for it.
--
-- This does that tagging by hand for the content that exists today — read
-- every one of the 15 rows and classified it on what it actually contains,
-- not the domain it came from:
--   - docs.python.org tutorial: a real Python code walkthrough -> sandbox
--   - the college submission on agentic tool-calling loops: a real
--     programming pattern, not an interview-communication topic -> sandbox
--   - apna.co job listings, all 9 PrepInsta interview-experience pages, and
--     both IndiaBix aptitude/verbal pages: none of these involve writing or
--     running code, they are interview narrative, aptitude questions, or
--     job listings -> rubric
--
-- lot-writer now reads this column first and only falls back to the keyword
-- heuristic when it is null. New content (crawler runs, college submissions)
-- has no hint yet and keeps using the heuristic until someone tags it — the
-- crawler itself is a separate Python codebase, out of scope here, and is
-- the real place this should eventually be set at ingestion time instead of
-- backfilled after the fact.

alter table public.source_content
  add column grading_mode_hint text check (grading_mode_hint in ('sandbox', 'rubric'));

update public.source_content set grading_mode_hint = 'sandbox'
 where id in (
   'ddeac9a7-ceb5-47d9-b375-e3efc87405f3', -- docs.python.org tutorial
   '7a3614ac-ff31-4cb1-a74a-45160263d17d'  -- agentic tool-calling loops (college submission)
 );

update public.source_content set grading_mode_hint = 'rubric'
 where id in (
   '6bc9c1e4-0788-476b-ae0c-94bfe9509619', -- apna.co job listings
   '54d9e7f4-1c45-40c2-8e2b-40af3cbe0df0', -- PrepInsta: TCS
   '5fba3af5-93ca-4ede-ab94-484bdb6bf16d', -- PrepInsta: Infosys
   'b0fcd0f7-0f8c-408f-94a8-2edbcbdf0f67', -- PrepInsta: Accenture
   '7ef8bb8e-6e58-4c95-8cbb-056a09febba6', -- PrepInsta: Wipro
   'aca0f8ad-ed12-4aa4-abfb-0b512cb3c2d3', -- PrepInsta: Capgemini
   '7614022a-3cd5-4f3e-843d-97fdad0b0d0d', -- PrepInsta: Cognizant
   'e325f537-c423-436a-bfa6-650cea04b95a', -- PrepInsta: Deloitte
   '8cfed9b7-f11a-4757-aae4-302031dbae70', -- PrepInsta: Microsoft
   '6865ca3f-08c3-4acf-9148-9d70234596b1', -- PrepInsta: PayPal
   '97f3c28a-d4eb-4bd4-aa78-63e0fe5c9988', -- PrepInsta: Mindtree
   '4e82ec38-eb8f-4410-8d0f-2973d4f4d666', -- IndiaBix aptitude
   '8bfa6747-9b39-4730-bcd8-119071f550c7'  -- IndiaBix verbal reasoning
 );
