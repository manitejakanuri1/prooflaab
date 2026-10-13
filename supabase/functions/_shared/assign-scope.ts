// Security gate 14 Oct (run-1 P0): who may use assign_tasks, for which students, with which task fields.
//
// assign_tasks writes with the service role, which bypasses row-level security, so the rules that
// migration 103 enforces on the browser path (tasks_college_insert, tasks_clamp_student_insert,
// task_templates_read) must be enforced here too, BEFORE any read of student data, AI call or write.
//
//   admin          everything, unchanged
//   college_admin  only with an approved AND active college, only that college's students,
//                  only admin templates or its own; task fields clamped like migration 103
//   anyone else    refused (startups have no screen that calls assign_tasks; 103 forbids their inserts)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TARGETS = 500;

export class ScopeError extends Error {}

/** The validated, de-duplicated target list. Throws a 'required' error (400) for a malformed list. */
export function targetIds(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TARGETS || !raw.every((v) => typeof v === "string" && UUID.test(v))) {
    throw new Error(`selected_students must be a list of at most ${MAX_TARGETS} student ids (required format)`);
  }
  return [...new Set(raw.map((v) => v.toLowerCase()))];
}

export type Scope = { admin: true; collegeId: null } | { admin: false; collegeId: string };

// deno-lint-ignore no-explicit-any
type Db = any;

/** Decides the caller's scope and checks every target against it. Throws 'Insufficient permissions' (403). */
export async function assignScope(db: Db, callerId: string, role: string, targets: string[]): Promise<Scope> {
  if (role === "admin") return { admin: true, collegeId: null };
  if (role !== "college_admin") throw new ScopeError("Insufficient permissions");

  const { data: college, error } = await db.from("colleges").select("id")
    .eq("user_id", callerId).eq("verification_status", "approved").eq("status", "active").maybeSingle();
  if (error || !college?.id) throw new ScopeError("Insufficient permissions");

  if (targets.length) {
    const { data: own, error: e2 } = await db.from("student_profiles").select("id")
      .in("id", targets).eq("college_id", college.id);
    const found = new Set((own ?? []).map((r: { id: string }) => String(r.id).toLowerCase()));
    if (e2 || targets.some((id) => !found.has(id))) throw new ScopeError("Insufficient permissions");
  }
  return { admin: false, collegeId: college.id };
}

/** A non-admin may use a template only if an admin made it (or nobody did) or the caller made it. */
export async function templateAllowed(db: Db, scope: Scope, callerId: string, createdBy: string | null): Promise<boolean> {
  if (scope.admin || createdBy === null || createdBy === callerId) return true;
  const { data } = await db.from("user_roles").select("role").eq("user_id", createdBy).maybeSingle();
  return data?.role === "admin";
}

/** Task fields a non-admin may not choose (mirrors tasks_clamp_student_insert in migration 103). */
export function clampTask<T extends Record<string, unknown>>(scope: Scope, fields: T): T {
  if (scope.admin) return fields;
  return { ...fields, xp_reward: 0, approved_by_admin: false, visibility: "private" };
}
