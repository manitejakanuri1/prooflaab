-- Step 6M: narrowly-scoped production correction for public.voice_explanations.
--
-- Production has never run migrations 41-46 and still has whatever broad
-- default grant created the table originally. A production read-only
-- inspection this step (Cloud SQL Studio, IAM login, deleted after) confirmed:
--
--   has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE')
--     = TRUE
--
-- and the table-level UPDATE ACL lists four roles: prooflab_app, anon,
-- authenticated, service_role. RLS is enabled (not forced) with policies for
-- INSERT/SELECT/DELETE only ("voice_own_insert", "voice_own_read",
-- "voice_own_delete") - no UPDATE policy exists.
--
-- This is the exact same gap migration 42 already found and fixed in
-- staging (see its own comment: "Every real UPDATE of this table already
-- runs as service_role"). Confirmed again here for production specifically:
-- grepping every server function and every frontend call site that touches
-- voice_explanations found zero legitimate UPDATE through `authenticated` or
-- `anon` - the frontend only .select()s, .insert()s (the student's own new
-- recording) and .delete()s (StudentPrivacy.tsx's delete-my-recording flow);
-- every real UPDATE (voice-score, transcription-enqueue) runs through
-- backend.ts's createClient(), which always mints a service_role token on
-- this backend regardless of which key a caller passes in.
--
-- Because no UPDATE policy exists, PostgREST-level exploitation is likely
-- already blocked today by RLS's default-deny for an unmatched command -
-- this migration does not fix an active hole, it removes a redundant,
-- unused table-level grant so that a future policy change (an accidental
-- ALL-command policy, or RLS being disabled) can't turn it back into one.
--
-- Deliberately does NOT touch service_role or prooflab_app: both are used
-- for real UPDATEs server-side and are not reachable directly by a student's
-- browser.
--
-- Given an unused migration number (47) rather than folding into 41-46,
-- because it has no dependency on the async transcription job/queue schema
-- and can ship to production on its own, ahead of or independent from that
-- larger rollout.
--
-- Staging test: this exact statement already ran successfully in staging as
-- part of migration 42 (which stacks the same REVOKE alongside other
-- changes); staging's authenticated/anon already lack this grant today, so
-- re-running the statement there is a documented Postgres no-op (REVOKE of a
-- privilege not held succeeds silently) - not re-executed separately here to
-- avoid a no-op action against staging that proves nothing beyond what
-- migration 42's own history already proved.

begin;

revoke update on public.voice_explanations from authenticated, anon;

commit;

notify pgrst, 'reload schema';
