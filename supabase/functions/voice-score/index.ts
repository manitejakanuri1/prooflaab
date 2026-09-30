import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";
import { scoreRecording, VOICE_SCORE_COLUMNS } from "../_shared/voiceScore.ts";

/**
 * Scores a 60-second spoken explanation.
 *
 * It grades HOW they explained, not whether the code was right — that is what
 * the rest of the verification engine is for. The signal we want is whether
 * this person actually did the work, and the tells for that are in the shape of
 * the speech rather than its correctness: hesitation in the right places,
 * decisions they changed their mind about, and their own vocabulary instead of
 * textbook phrasing.
 *
 * Two callers:
 *  - a student, for their own BROWSER recording only (the synchronous path);
 *  - transcription-worker (Step 6 G1), right after it saves a server
 *    transcript, so a recording is scored even if the student closed the
 *    browser. It sends a service_role token; that path only accepts a
 *    recording the server itself transcribed.
 * The grading itself, and the migration-45 claim that makes it happen once,
 * live in _shared/voiceScore.ts.
 */

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Request-specific CORS on every reply, not only the preflight.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsError } =
      await authClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsError || !claims) return json({ error: 'Invalid token' }, 401);
    const callerId = claims.claims.sub;
    // Signature-verified above: only a holder of the JWT secret can mint this role.
    const isService = claims.claims.role === 'service_role';

    const { voice_id } = await req.json();
    if (!voice_id) return json({ error: 'voice_id is required' }, 400);
    // A malformed id is the caller's mistake (400), not a database failure (503)
    // and not a missing recording (404).
    if (typeof voice_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(voice_id)) {
      return json({ error: 'voice_id is not a valid id' }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    let profileId: string | null = null;
    if (!isService) {
      const { data: profile, error: profileError } = await supabase
        .from('student_profiles').select('id').eq('user_id', callerId).maybeSingle();
      // A failed read is not "no such student" - say so, rather than a misleading 404.
      if (profileError) {
        console.error('voice-score: profile read failed', profileError);
        return json({ error: 'Could not read your profile. Please try again.' }, 503);
      }
      if (!profile) return json({ error: 'Student profile not found' }, 404);
      profileId = profile.id;
    }

    const { data: rec, error: recError } = await supabase
      .from('voice_explanations')
      .select(VOICE_SCORE_COLUMNS)
      .eq('id', voice_id)
      .maybeSingle();
    if (recError) {
      console.error('voice-score: recording read failed', recError);
      return json({ error: 'Could not read the recording. Please try again.' }, 503);
    }
    if (!rec) return json({ error: 'Recording not found' }, 404);

    if (isService) {
      // Step 6 G1: the server path scores only what the server transcribed -
      // never a browser-supplied transcript, never one still in progress.
      if (rec.transcript_source !== 'server' || rec.transcription_status !== 'completed') {
        return json({ success: false, reason: 'not a completed server transcription' }, 409);
      }
    } else {
      if (rec.student_id !== profileId) return json({ error: 'Forbidden' }, 403);
      // A server-transcribed recording is scored only by the server, after its
      // transcript exists (transcription-worker / transcription-reap). A student
      // asking early could otherwise mark an unfinished recording "too short".
      // The student's own browser recordings (the synchronous path) are unchanged.
      if (rec.transcript_source === 'server') {
        return json({ success: false, reason: 'This recording is scored automatically by the server.' }, 403);
      }
    }

    const result = await scoreRecording(supabase, rec);
    return json(result.body, result.status);
  } catch (error) {
    console.error('voice-score error:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
