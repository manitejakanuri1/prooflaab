import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";
import { guard } from "../_shared/rate-limit.ts";

/**
 * A company plays one voice explanation (migration 105).
 *
 * The audio is private and lives in the student's own folder, so the file
 * service refuses everyone but the student. This function is the one door for a
 * company: company_voice_recording() decides (verified company, discoverable
 * student who switched audio sharing on, recording scored and not withdrawn),
 * writes who listened to what, and answers the path. The bytes are read here
 * and sent back; the browser never learns the path and gets no link to share.
 *
 * POST { voice_id: uuid } -> the audio bytes, or 404 for every kind of refusal.
 */
serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const limited = await guard(req, { bucket: "company-voice-play", limit: 120, windowSeconds: 3600, corsHeaders });
  if (limited) return limited;

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: claims } = await db.auth.getClaims(auth.slice(7));
    const companyId = claims?.claims?.sub as string | undefined;
    if (!companyId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const voiceId = typeof body?.voice_id === "string" ? body.voice_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(voiceId)) return json({ error: "Recording not available." }, 404);

    const { data: path, error } = await db.rpc("company_voice_recording", { _company: companyId, _voice_id: voiceId });
    if (error) throw error;
    if (typeof path !== "string" || !path) return json({ error: "Recording not available." }, 404);

    const { data: audio } = await db.storage.from("voice-explanations").download(path);
    if (!audio) return json({ error: "Recording not available." }, 404);

    // octet-stream so the browser client hands the page a Blob; never cached, never a link.
    return new Response(audio, {
      headers: { ...corsHeaders, "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("company-voice-play failed:", err instanceof Error ? err.message : String(err));
    return json({ error: "Could not load the recording." }, 500);
  }
});
