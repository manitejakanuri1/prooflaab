import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { guard } from "../_shared/rate-limit.ts";
import { cors } from "../_shared/cors.ts";
import { runOnOwnRunner } from "../_shared/sandbox.ts";

/**
 * "Run" button on a lesson's code example: run the student's code and hand back what it
 * printed. Nothing is graded and nothing is saved.
 *
 * ProofLab's own runner only. The shared runCode() falls back to free public runners
 * (Wandbox, Godbolt, Glot) for graded tasks; free practice code is not sent to them.
 * The runner itself limits time (10 s to run, 40 s to compile), output size and memory,
 * and runs as an unprivileged user.
 */

const LANGUAGES = new Set(["python", "javascript", "ruby", "php", "c", "cpp", "go", "java"]);

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Request-specific CORS on every reply, not only the preflight: an allowed non-primary
  // origin (a preview channel) must get its own origin back on the POST too.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = claims?.claims?.sub as string | undefined;
    if (!callerId) return json({ error: "Unauthorized" }, 401);

    // 120 runs an hour is one every 30 seconds all day; a student practising stays far under it.
    const limited = await guard(req, { bucket: "run-code", limit: 120, windowSeconds: 3600, userId: callerId, corsHeaders });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const language = String(body?.language ?? "").toLowerCase();
    const code = body?.code;
    const stdin = typeof body?.stdin === "string" ? body.stdin : "";
    if (!LANGUAGES.has(language)) return json({ error: `Cannot run ${language || "that language"} here` }, 400);
    if (typeof code !== "string" || !code.trim()) return json({ error: "There is no code to run" }, 400);
    if (code.length > 20000) return json({ error: "Code is too long (max 20,000 characters)" }, 400);
    if (stdin.length > 2000) return json({ error: "Input is too long (max 2,000 characters)" }, 400);

    const started = Date.now();
    const run = await runOnOwnRunner(language, code, stdin).catch((e) => ({ ok: false as const, reason: String(e) }));
    if (!run.ok) {
      console.error("run-code: runner unavailable:", run.reason);
      return json({ status: "busy" });
    }
    return json({
      status: run.status,
      stdout: run.stdout.slice(0, 10000),
      stderr: run.stderr.slice(0, 4000),
      ms: Date.now() - started,
    });
  } catch (e) {
    console.error("run-code error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
