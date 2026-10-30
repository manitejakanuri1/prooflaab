import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";
import { guard } from "../_shared/rate-limit.ts";

/**
 * Someone other than the student plays one voice explanation (migrations 105, 168).
 *
 * The audio is private and lives in the student's own folder, so the file
 * service refuses everyone but the student. This function is the one door for
 * admin, the student's own college and companies: company_voice_recording()
 * decides (admin / own college always; a verified company only when the student's
 * one switch is on and the recording is scored and not withdrawn),
 * writes who listened to what, and answers the path. The bytes are read here
 * and sent back; the browser never learns the path and gets no link to share.
 *
 * POST { voice_id: uuid } -> the audio bytes, or 404 for every kind of refusal.
 */
/** MF-024: the stored type when it is audio, else a guess from the file name (webm is what browsers record). */
export function audioType(stored: string | undefined, path: string): string {
  if (stored && stored.startsWith("audio/")) return stored;
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "mp4" || ext === "m4a" ? "audio/mp4" : ext === "ogg" ? "audio/ogg" : ext === "wav" ? "audio/wav" : "audio/webm";
}

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
    // MF-024: the real audio type rides in X-Audio-Type, so the player is told what it is playing.
    return new Response(audio, {
      headers: {
        ...corsHeaders, "Content-Type": "application/octet-stream", "Cache-Control": "no-store",
        "X-Audio-Type": audioType(audio.type, path), "Access-Control-Expose-Headers": "X-Audio-Type",
      },
    });
  } catch (err) {
    console.error("company-voice-play failed:", err instanceof Error ? err.message : String(err));
    return json({ error: "Could not load the recording." }, 500);
  }
});
