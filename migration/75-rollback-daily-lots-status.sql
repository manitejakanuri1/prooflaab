-- Rollback of 75: re-apply assign_todays_lots() from migration 68 (no status field), and put the
-- previous functions image back (the current scheduled-job reads result.status).
\i migration/68-daily-lots-isolate-failures.sql
