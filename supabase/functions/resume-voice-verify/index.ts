import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const callerId = claims.claims.sub;

    const { scorecard_id, storage_path, mime_type } = await req.json();
    if (!scorecard_id || !storage_path) {
      return new Response(
        JSON.stringify({ error: 'scorecard_id and storage_path are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!storage_path.startsWith(`${callerId}/`)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'Student profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: scorecard, error: scorecardError } = await supabase
      .from('resume_scorecards')
      .select('id, student_id, assessment_id')
      .eq('id', scorecard_id)
      .maybeSingle();

    if (scorecardError || !scorecard) {
      return new Response(
        JSON.stringify({ error: 'Scorecard not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (scorecard.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: assessment } = await supabase
      .from('resume_assessments')
      .select('questions, student_answers, answer_scores')
      .eq('id', scorecard.assessment_id)
      .maybeSingle();

    const questions = (assessment?.questions ?? []) as any[];
    const studentAnswers = (assessment?.student_answers ?? []) as any[];
    const answersById = new Map(studentAnswers.map((a: any) => [a.question_id, a]));

    const qaSummary = questions.map((q: any, i: number) => {
      const a = answersById.get(q.id);
      return `${i + 1}. Q: ${q.prompt}\n   Their answer: ${a?.answer_text || '(no answer)'}`;
    }).join('\n');

    const { data: audioBlob, error: downloadError } = await supabase
      .storage
      .from('voice-explanations')
      .download(storage_path);
    if (downloadError || !audioBlob) {
      return new Response(
        JSON.stringify({ error: 'Could not read voice recording' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (audioBlob.size > MAX_AUDIO_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Recording is too large' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
    const base64Audio = bytesToBase64(audioBytes);

    const prompt = `A student just took a quiz about their own resume claims. Here are the exact questions and the answers they typed/selected during the quiz:

${qaSummary}

Attached is an audio recording of the SAME student, right after the quiz, explaining out loud why they chose those specific answers.

Listen to the recording and judge:
1. Does what they say out loud actually reference and match their specific answers above (not vague generic talk)?
2. Does it sound like a real person who understood the material, or like they're guessing / reading something unrelated / staying silent / refusing to explain?

Return ONLY a JSON object:
{
  "authenticity_score": <0-100, how genuinely this explanation matches and justifies their specific answers>,
  "notes": "<one or two sentences on why, be specific about what they did or didn't reference>"
}`;

    let geminiResponse!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: mime_type || 'audio/webm', data: base64Audio } },
                { text: prompt }
              ]
            }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 500 }
          })
        }
      );
      if (geminiResponse.ok || ![429, 503].includes(geminiResponse.status)) break;
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to analyze voice explanation' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let authenticity_score = 0;
    let notes = 'Could not analyze the recording.';
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        authenticity_score = Math.max(0, Math.min(100, Math.round(parsed.authenticity_score) || 0));
        notes = parsed.notes || notes;
      }
    } catch (e) {
      console.error('Failed to parse Gemini voice analysis:', e);
    }

    const { error: updateError } = await supabase
      .from('resume_scorecards')
      .update({ voice_authenticity_score: authenticity_score, voice_notes: notes })
      .eq('id', scorecard_id);

    if (updateError) {
      console.error('Error saving voice verification:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save voice verification' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, voice_authenticity_score: authenticity_score, voice_notes: notes }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-voice-verify:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
