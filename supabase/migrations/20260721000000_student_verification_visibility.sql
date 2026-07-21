-- Let students see the verification results for THEIR OWN proofs.
--
-- Why: github_verifications and ai_verifications were admin/college_admin only,
-- so the student — the person who most needs the feedback in order to improve —
-- could see nothing but a one-line truncated review_comment. The whole point of
-- the Cognitive Integrity Score is developmental: a student should be able to
-- see *why* they scored what they scored.
--
-- Scope: SELECT only, and only for rows tied to a proof they own. Students still
-- cannot INSERT or UPDATE these tables — only the edge functions (service role)
-- and admins/colleges can write verification results. A student cannot see any
-- other student's verification data.

-- ---------------------------------------------------------------------------
-- github_verifications
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Students can view their own github verifications"
  ON public.github_verifications;

CREATE POLICY "Students can view their own github verifications"
ON public.github_verifications
FOR SELECT
TO authenticated
USING (
  proof_id IN (
    SELECT pu.id
    FROM public.proof_uploads pu
    WHERE pu.student_id IN (
      SELECT sp.id
      FROM public.student_profiles sp
      WHERE sp.user_id = auth.uid()
    )
  )
);

-- ---------------------------------------------------------------------------
-- ai_verifications
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Students can view their own ai verifications"
  ON public.ai_verifications;

CREATE POLICY "Students can view their own ai verifications"
ON public.ai_verifications
FOR SELECT
TO authenticated
USING (
  proof_id IN (
    SELECT pu.id
    FROM public.proof_uploads pu
    WHERE pu.student_id IN (
      SELECT sp.id
      FROM public.student_profiles sp
      WHERE sp.user_id = auth.uid()
    )
  )
);

-- NOTE: trust_scores already has an equivalent policy in the live database
-- ("Users can view their own trust score", same student_id -> student_profiles
-- check), so nothing is added here. Adding a second identical permissive policy
-- would only be noise — permissive policies are OR'd together.

-- Supporting indexes for the proof_id lookups these policies perform.
CREATE INDEX IF NOT EXISTS idx_github_verifications_proof_id
  ON public.github_verifications(proof_id);
CREATE INDEX IF NOT EXISTS idx_ai_verifications_proof_id
  ON public.ai_verifications(proof_id);
