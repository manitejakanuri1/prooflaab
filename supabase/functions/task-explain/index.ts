import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsStatic, "Content-Type": "application/json" } });

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Keep only the shape the screen draws; anything else from the model is dropped. */
function clean(raw: any) {
  const brief = {
    in_one_line: str(raw?.in_one_line, 200),
    what_it_means: str(raw?.what_it_means, 700),
    steps: (Array.isArray(raw?.steps) ? raw.steps : []).map((s: unknown) => str(s, 300)).filter(Boolean).slice(0, 7),
    example: str(raw?.example, 700) || null,
    words: (Array.isArray(raw?.words) ? raw.words : [])
      .map((w: any) => ({ word: str(w?.word, 40), meaning: str(w?.meaning, 200) }))
      .filter((w: { word: string; meaning: string }) => w.word && w.meaning).slice(0, 5),
    done_when: str(raw?.done_when, 300),
  };
  if (!brief.in_one_line || !brief.what_it_means || brief.steps.length < 2 || !brief.done_when) return null;
  return brief;
}

const prompt = (title: string, description: string, code: string | null, coding: boolean) => `
You explain a work task to an Indian engineering student who finds English and coding hard.
Explain it the way you would to a 12-year-old: short sentences, everyday words, no jargon without explaining it.
Do NOT solve the task and do NOT give the answer or the code. Only make the QUESTION crystal clear.

Task title: ${title}
Task: ${description}
${code ? `Code that comes with the task:\n${code.slice(0, 1500)}\n` : ""}${coding ? "This is a coding task, solved in the code editor inside the app.\n" : "This is a written task: the student types an answer inside the app.\n"}
Return JSON only:
{"in_one_line":"what you must do, in one simple sentence",
 "what_it_means":"2 to 4 short sentences: the situation and what is being asked, in simple words",
 "steps":["3 to 6 small steps, each one short action starting with a verb"],
 "example":"a tiny made-up example that shows what kind of thing is asked (not the answer), or null",
 "words":[{"word":"a hard word from the task","meaning":"its meaning in simple words"}],
 "done_when":"one sentence: how the student knows they have finished"}`.trim();

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    const title = String(task.title ?? "").trim();
    const description = String(task.description ?? "").trim();
    if (description.length < 20) return json({ brief: null });

    const key = await sha256(`${title}\n${description}`);
    const { data: saved } = await db.from("task_explainers").select("brief").eq("key", key).maybeSingle();
    if (saved) return json({ brief: saved.brief, cached: true });

    // Two tries: a reply that is not valid JSON, or misses a part, is asked again once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await generateText(
        prompt(title, description, task.code_sample ?? null, Boolean(task.sandbox_config_id)),
        { temperature: 0.4, maxOutputTokens: 1500 },
        { feature: "task-explain", userId: callerId },
      );
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(out.text.replace(/```json|```/g, "").replace(/,\s*([}\]])/g, "$1"));
      } catch { /* try again */ }
      const brief = clean(parsed);
      if (brief) {
        await db.from("task_explainers").upsert({ key, brief }, { onConflict: "key" });
        return json({ brief, cached: false });
      }
    }
    return json({ brief: null });
  } catch (err) {
    console.error("task-explain failed:", err);
    return json({ brief: null, error: (err as Error).message }, 500);
  }
});
