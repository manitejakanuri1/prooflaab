-- Make every row-security rule ask "who is this?" once per query instead of
-- once per row.
--
-- Postgres treats an uncorrelated scalar subquery as an InitPlan: it runs it a
-- single time and reuses the answer for the whole statement. A bare auth.uid()
-- sitting in a policy gets no such treatment, so it is called again for every
-- row the query touches. Same for has_role(), which is STABLE but still gets
-- invoked per row when written inline.
--
-- Wrapping does not change what any rule means. Every function involved
-- (has_role, is_admin, is_email_confirmed, get_current_student_id) is STABLE
-- and takes only statement-constant arguments, so hoisting is safe.
--
-- Deliberately NOT wrapped: is_student_owner(student_id, ...) and
-- same_college(a, b) take a column from the row being checked, so they cannot
-- be hoisted -- only the auth.uid() inside them is.
--
-- Verified with EXPLAIN afterwards: the tasks policy filter now reads
--   (InitPlan 3).col1 OR (InitPlan 4).col1 OR (InitPlan 5).col1
-- where every one of those was a per-row function call before.
--
-- To undo: run the same loop replacing '( SELECT auth.uid() AS uid)' with
-- 'auth.uid()' and stripping the '( SELECT ... )' around the helper calls.

DO $$
DECLARE
  r       RECORD;
  q       TEXT;
  w       TEXT;
  stmt    TEXT;
  touched INT := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    q := r.qual;
    w := r.with_check;

    IF q IS NOT NULL THEN
      q := regexp_replace(q, 'has_role\(auth\.uid\(\), ([^()]*)\)',
                             '(SELECT has_role(<<U>>, ))', 'g');
      q := replace(q, 'is_email_confirmed(auth.uid())', '(SELECT is_email_confirmed(<<U>>))');
      q := replace(q, 'is_admin()',                     '(SELECT is_admin())');
      q := replace(q, 'get_current_student_id()',       '(SELECT get_current_student_id())');
      q := replace(q, 'auth.uid()',                     '(SELECT auth.uid())');
      q := replace(q, '<<U>>',                          'auth.uid()');
    END IF;

    IF w IS NOT NULL THEN
      w := regexp_replace(w, 'has_role\(auth\.uid\(\), ([^()]*)\)',
                             '(SELECT has_role(<<U>>, ))', 'g');
      w := replace(w, 'is_email_confirmed(auth.uid())', '(SELECT is_email_confirmed(<<U>>))');
      w := replace(w, 'is_admin()',                     '(SELECT is_admin())');
      w := replace(w, 'get_current_student_id()',       '(SELECT get_current_student_id())');
      w := replace(w, 'auth.uid()',                     '(SELECT auth.uid())');
      w := replace(w, '<<U>>',                          'auth.uid()');
    END IF;

    IF q IS DISTINCT FROM r.qual OR w IS DISTINCT FROM r.with_check THEN
      stmt := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
      IF q IS NOT NULL THEN stmt := stmt || ' USING (' || q || ')'; END IF;
      IF w IS NOT NULL THEN stmt := stmt || ' WITH CHECK (' || w || ')'; END IF;
      EXECUTE stmt;
      touched := touched + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'rewrote % policies', touched;
END $$;
