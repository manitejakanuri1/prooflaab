// Who may act on a student's work.
//
// The RLS policy on proof_uploads already answers this correctly:
//
//   create policy proof_uploads_college_read ... using (student_id in (
//     select sp.id from student_profiles sp
//     join colleges c on c.id = sp.college_id
//     where c.user_id = (select auth.uid())));
//
// but every function here runs with the service-role key, which bypasses RLS
// entirely, so each one re-implements the check by hand. Five of them re-
// implemented it as `role === 'admin' || role === 'college_admin'` with the
// college half of that condition missing, which let any college_admin reach
// every student on the platform rather than their own. Since college_admin was
// self-grantable at signup, that was one dropdown away from the private proofs
// bucket.
//
// One function, so the scoping cannot drift out of sync in five places again.

type Queryable = { from: (table: string) => any };

/** Where a piece of student work sits: whose account, and which college. */
export interface StudentWork {
  /** student_profiles.user_id — the auth user who owns it. */
  ownerUserId: string | null;
  /** student_profiles.college_id — null for a student with no college. */
  collegeId: string | null;
}

/**
 * True when `callerId` may read or act on this work.
 *
 * Owner: always. Platform admin: always. College admin: only for a student in
 * a college that admin actually owns — the check the five callers were missing.
 * Everyone else: no.
 *
 * Reads with whatever client it is handed. Pass the service-role client the
 * caller already built; a caller's own client would be filtered by RLS and
 * could not see the college row it needs to compare against.
 */
export async function mayActOnStudentWork(
  supabase: Queryable,
  callerId: string,
  work: StudentWork,
): Promise<boolean> {
  if (!callerId) return false;

  if (work.ownerUserId && work.ownerUserId === callerId) return true;

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', callerId);

  const roleNames = (roles ?? []).map((r: { role: string }) => r.role);

  if (roleNames.includes('admin')) return true;

  if (roleNames.includes('college_admin')) {
    // No college on the student means no college can claim them. Without this
    // guard `.eq('id', null)` would match nothing anyway, but failing closed
    // here says so on purpose rather than by accident.
    if (!work.collegeId) return false;

    // verification_status must match my_approved_college_ids() in the RLS
    // policies (stage 63). These functions run with the service-role key and so
    // never touch those policies - if the check is not repeated here, an
    // unapproved college is refused by the database and waved through by the
    // edge function.
    const { data: owned } = await supabase
      .from('colleges')
      .select('id')
      .eq('id', work.collegeId)
      .eq('user_id', callerId)
      .eq('verification_status', 'approved')
      .maybeSingle();

    return !!owned;
  }

  return false;
}

/** The 403 these callers all return, so the wording stays identical. */
export function forbidden(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: 'Forbidden' }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
