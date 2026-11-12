-- P4 (12 Nov 2026): the college/admin student profile onboarding lines read "resume score 6.7/10 ? ATS 6.2/10".
-- Cause: migration 220 was saved with the middle dot (U+00B7) turned into "?" by a non-UTF-8 round trip, so
-- tpo_student_profile() joins its three concat_ws() lines with ' ? '. Migrations 121/122 had ' · '.
-- Fix: rewrite the live function body, turning only concat_ws(' ? ' into concat_ws(' · ' (chr(183), so this file
-- cannot be mangled the same way). The jsonb ? operator is untouched. Nothing else changes.
-- Rollback: migration/400-rollback-profile-middle-dot.sql
begin;
set timezone to 'Asia/Kolkata';

do $$
declare def text := pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure);
begin
  if position('concat_ws('' ? ''' in def) > 0 then
    execute replace(def, 'concat_ws('' ? ''', 'concat_ws('' ' || chr(183) || ' ''');
  end if;
end $$;

do $$
declare def text := pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure);
begin
  if position('concat_ws('' ? ''' in def) > 0 then
    raise exception '400: tpo_student_profile still joins with a bare ?';
  end if;
  if position('concat_ws('' ' || chr(183) || ' ''' in def) = 0 then
    raise exception '400: tpo_student_profile has no middle-dot join';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
