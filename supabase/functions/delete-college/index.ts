import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";

/**
 * Admin -> Colleges -> Delete college (13 Oct). Admin only.
 *
 * Deleting only the colleges row left the college admin's role and Google login behind, so that email
 * could never be used for a new college ("An account with this email already exists"). This removes all
 * three, in an order where every step can be retried:
 *   1. refuse while the college has any student (exact count);
 *   2. delete the colleges row (its squads, seasons and imports follow the existing foreign keys);
 *   3. if its admin owns no other college: delete the college_admin role, then the login through the
 *      accounts service's /delete-user, which only deletes an account with no role or organisation left.
 *
 * Body: { college_id }  or  { user_id } for a leftover college admin whose college is already gone.
 */
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401, corsHeaders);
    const { data: who, error: whoErr } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
    if (whoErr || !who?.user) return json({ error: "Unauthorized" }, 401, corsHeaders);
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", who.user.id);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403, corsHeaders);

    const body = await req.json().catch(() => ({}));
    const collegeId = typeof body.college_id === "string" && UUID.test(body.college_id) ? body.college_id : null;
    let ownerId = typeof body.user_id === "string" && UUID.test(body.user_id) ? body.user_id : null;
    if (!collegeId && !ownerId) return json({ error: "college_id or user_id is required" }, 400, corsHeaders);

    let collegeDeleted = false;
    if (collegeId) {
      const { data: college } = await db.from("colleges").select("id, user_id, name").eq("id", collegeId).maybeSingle();
      if (!college) return json({ error: "No such college" }, 404, corsHeaders);
      const { count, error: countErr } = await db.from("student_profiles")
        .select("id", { count: "exact", head: true }).eq("college_id", collegeId);
      if (countErr) return json({ error: "Could not count the students. Nothing was changed." }, 503, corsHeaders);
      if (count) {
        return json({ error: `${college.name} still has ${count} students. Remove them first.` }, 409, corsHeaders);
      }
      const { error: delErr } = await db.from("colleges").delete().eq("id", collegeId);
      if (delErr) return json({ error: `The college was not deleted: ${delErr.message}` }, 409, corsHeaders);
      collegeDeleted = true;
      ownerId = college.user_id;
    }

    // The admin's login, only when this person is a college admin who no longer owns any college.
    let loginDeleted = false;
    let loginNote = "";
    if (ownerId) {
      const { data: ownerRoles } = await db.from("user_roles").select("role").eq("user_id", ownerId);
      const isCollegeAdmin = (ownerRoles ?? []).length === 1 && ownerRoles![0].role === "college_admin";
      const { count: stillOwns } = await db.from("colleges")
        .select("id", { count: "exact", head: true }).eq("user_id", ownerId);
      if (!isCollegeAdmin || stillOwns) {
        loginNote = "The admin's login was kept: it is not a college admin without a college.";
        if (!collegeId) return json({ error: loginNote }, 409, corsHeaders);
      } else {
        const { error: roleErr } = await db.from("user_roles").delete().eq("user_id", ownerId).eq("role", "college_admin");
        const { error: loginErr } = roleErr ? { error: roleErr } : await db.auth.admin.deleteUser(ownerId);
        loginDeleted = !loginErr;
        if (loginErr) loginNote = `The admin's login could not be deleted: ${loginErr.message}`;
      }
    }

    console.log(`delete-college by ${who.user.id}: college ${collegeId ?? "-"} deleted=${collegeDeleted}, login deleted=${loginDeleted}`);
    return json({ college_deleted: collegeDeleted, login_deleted: loginDeleted, note: loginNote || null }, 200, corsHeaders);
  } catch (error) {
    console.error("delete-college error:", error);
    return json({ error: "Internal server error" }, 500, corsHeaders);
  }
});
