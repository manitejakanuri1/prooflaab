-- Where a job posting came from.
--
-- StartupJobsPage has always sent source: 'startup' with every insert. The
-- column it was sending it to did not exist, so PostgREST rejected the whole
-- row for an unknown column and no startup could post a job at all. Found by
-- regenerating the database types and typechecking, not by reading the screen.
--
-- 'crawler' is here because the daily Lot work will post jobs the same way.
alter table public.job_opportunities
  add column source text not null default 'admin'
    check (source in ('admin', 'startup', 'crawler'));
