import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { guard } from "../_shared/rate-limit.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { gradeTests, type SandboxTest } from "../_shared/sandbox.ts";

/**
 * Practice run for a sandbox task: grades only the VISIBLE tests, never
 * writes a task_submissions row. Nothing here can complete a task or pay
 * XP — that only happens through submit-sandbox-task.
 *
 * Also doubles as the admin content-check: pass {config_id, use_reference:
 * true} to grade the config's own reference_solution against every test
 * (visible and hidden). A config should not be linked to a real task until
 * that check returns score: 100.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = claims?.claims?.sub as string | undefined;
    if (!callerId) return json({ error: "Unauthorized" }, 401);

    const limited = await guard(req, {
      bucket: "run-sandbox", limit: 60, windowSeconds: 3600, userId: callerId, corsHeaders,
    });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const db = createClient(url, serviceKey);

    // Admin reference check: no task involved, grades the config directly.
    if (body?.use_reference === true) {
      const configId = body?.config_id;
      if (typeof configId !== "string") return json({ error: "config_id is required" }, 400);

      const { data: roles } = await db.from("user_roles").select("role").eq("user_id", callerId);
      if (!(roles ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403);

      const { data: cfg } = await db.from("task_sandbox_config")
        .select("language, test_cases, reference_solution").eq("id", configId).maybeSingle();
      if (!cfg) return json({ error: "No such config" }, 404);

      const graded = await gradeTests(cfg.language, cfg.reference_solution, cfg.test_cases as SandboxTest[]);
      return json(graded, graded.ok ? 200 : 503);
    }

    const taskId = body?.task_id;
    const code = body?.code;
    if (typeof taskId !== "string" || typeof code !== "string" || !code.trim()) {
      return json({ error: "task_id and code are required" }, 400);
    }
    if (code.length > 20000) return json({ error: "Code is too long (max 20,000 characters)" }, 400);

    const { data: profile } = await db.from("student_profiles").select("id").eq("user_id", callerId).maybeSingle();
    if (!profile) return json({ error: "Student profile not found" }, 404);

    const { data: task } = await db.from("tasks")
      .select("id, student_id, sandbox_config_id").eq("id", taskId).maybeSingle();
    if (!task?.sandbox_config_id) return json({ error: "This is not a coding task" }, 404);
    if (task.student_id !== profile.id) {
      const { data: assigned } = await db.from("task_assignments")
        .select("id").eq("task_id", taskId).eq("student_id", profile.id).maybeSingle();
      if (!assigned) return json({ error: "Task not found" }, 404);
    }

    const { data: cfg } = await db.from("task_sandbox_config")
      .select("language, test_cases").eq("id", task.sandbox_config_id).single();

    // Visible tests only — hidden inputs never leave the server through this
    // endpoint. All results returned unredacted since every one shown IS visible.
    const visible = (cfg.test_cases as SandboxTest[]).filter((t) => t.visible);
    if (visible.length === 0) return json({ results: [] });

    const graded = await gradeTests(cfg.language, code, visible);
    if (!graded.ok) {
      return json({
        error: "The code runner is busy right now. This is not a problem with your code. Try again in a minute.",
        runner_unavailable: true,
      }, 503);
    }

    return json({ results: graded.results, score: graded.score });
  } catch (e) {
    console.error("run-sandbox error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
