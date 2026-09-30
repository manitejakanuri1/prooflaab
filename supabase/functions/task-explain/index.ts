import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { explainTask } from "../_shared/explain.ts";
import { cors } from "../_shared/cors.ts";

/**
 * "Explained simply": the task retold so a below-average student understands
 * exactly what is being asked before they start (owner's request, 19 Sep 2026).
 *
 * One write per distinct task text, kept forever in task_explainers - every
 * student on the same Lot reads the same row, and nothing is paid twice.
 * Body: { task_id } for a student's own task (or any task, for an admin), or
 * { lot_template_id } for an admin writing tomorrow's Lots ahead of time -
 * a Lot's tasks carry its title and scenario, so they share the same row.
 */

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Request-specific CORS on every reply, not only the preflight.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const { task_id, lot_template_id } = await req.json().catch(() => ({}));
    if (typeof task_id !== "string" && typeof lot_template_id !== "string") {
      return json({ error: "task_id is required" }, 400);
    }

    const db = createClient(url, serviceKey);
    const isAdmin = async () => {
      const { data: roles } = await db.from("user_roles").select("role").eq("user_id", callerId);
      return (roles ?? []).some((r: { role: string }) => r.role === "admin");
    };

    let task: { title: string | null; description: string | null; code_sample: string | null; sandbox_config_id: string | null } | null;
    if (typeof task_id === "string") {
      const { data } = await db
        .from("tasks")
        .select("student_id, title, description, code_sample, sandbox_config_id")
        .eq("id", task_id)
        .maybeSingle();
      if (!data) return json({ error: "No such task" }, 404);
      if (data.student_id !== callerId && !(await isAdmin())) return json({ error: "Not your task" }, 403);
      task = data;
    } else {
      if (!(await isAdmin())) return json({ error: "Admins only" }, 403);
      const { data } = await db
        .from("lot_templates")
        .select("title, scenario, code_sample, sandbox_config_id")
        .eq("id", lot_template_id)
        .maybeSingle();
      if (!data) return json({ error: "No such Lot" }, 404);
      task = { title: data.title, description: data.scenario, code_sample: data.code_sample, sandbox_config_id: data.sandbox_config_id };
    }

    return json(await explainTask(db, task, callerId));
  } catch (err) {
    console.error("task-explain failed:", err);
    return json({ brief: null, error: (err as Error).message }, 500);
  }
});
