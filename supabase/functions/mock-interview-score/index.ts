import { serve } from "../_shared/serve.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from "../_shared/rate-limit.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";

/**
 * Grades all four answers together in one call rather than one call per
 * question — an interviewer forms one impression across the whole
 * conversation, and four separate 0-100s would double-count the same
 * nervousness or fluency four times.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsStatic, 'Content-Type': 'application/json' },
  });

interface Answer { n: number; transcript: string | null; duration_seconds: number | null }

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

    const { interview_id } = await req.json();
    if (!interview_id) return json({ error: 'interview_id is required' }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await supabase
      .from('student_profiles').select('id').eq('user_id', callerId).maybeSingle();
    if (!profile) return json({ error: 'Student profile not found' }, 404);

    const { data: interview } = await supabase
      .from('mock_interviews')
      .select('id, student_id, target_role, questions, answers, status')
      .eq('id', interview_id)
      .maybeSingle();
    if (!interview) return json({ error: 'Interview not found' }, 404);
    if (interview.student_id !== profile.id) return json({ error: 'Forbidden' }, 403);
    if (interview.status !== 'answering') return json({ error: 'Already scored' }, 409);

    const questions = interview.questions as string[];
    const answers = interview.answers as Answer[];
    if (answers.length < questions.length) {
      return json({ error: 'Not all questions have been answered yet' }, 400);
    }

    const transcript = questions.map((q, i) => {
      const a = answers.find((x) => x.n === i);
      const spoken = a?.transcript?.trim();
      return `Q${i + 1}: ${q}\nA${i + 1}: ${spoken || '(no speech captured — browser could not transcribe this answer)'}`;
    }).join('\n\n');

    const prompt = `You interviewed a candidate for "${interview.target_role}". Here is the full transcript:

${transcript}

Grade the interview as a whole, the way a real interviewer debriefs afterward — not each answer in isolation.
Judge: relevance to the question actually asked, specificity (real examples vs generic statements), clarity of
explanation, and how they'd come across live. Be fair to nervous or short answers — clarity matters more than
polish. An answer with "(no speech captured...)" scores 0 for that question but should not by itself sink the rest.

Return ONLY JSON:
{
  "overall_score": <0-100>,
  "overall_feedback": "<3-4 sentences, addressed to the candidate, plain English, one concrete thing to improve>",
  "per_question": [{"n": 0, "score": <0-100>, "note": "<one sentence>"}, ...]
}`;

    let parsed: { overall_score?: number; overall_feedback?: string; per_question?: { n: number; score: number; note: string }[] } = {};
    try {
      const { text } = await generateText(prompt, { temperature: 0.3, maxOutputTokens: 900 },
        { feature: 'mock-interview-score', studentId: profile.id });
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch (e) {
      console.error('mock-interview-score: could not grade', e);
      await supabase.from('mock_interviews').update({ status: 'failed' }).eq('id', interview_id);
      return json({ error: 'Scoring failed. Please try again.' }, 502);
    }

    const overallScore = Math.max(0, Math.min(100, Math.round(Number(parsed.overall_score) || 0)));
    const perQuestion = Array.isArray(parsed.per_question) ? parsed.per_question : [];

    const mergedAnswers = answers.map((a) => {
      const graded = perQuestion.find((p) => p.n === a.n);
      return { ...a, score: graded?.score ?? null, feedback: graded?.note ?? null };
    });

    await supabase.from('mock_interviews').update({
      answers: mergedAnswers,
      overall_score: overallScore,
      overall_feedback: parsed.overall_feedback ?? null,
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', interview_id);

    await supabase.rpc('touch_streak', { _student_id: profile.id });

    return json({ success: true, overall_score: overallScore, overall_feedback: parsed.overall_feedback ?? null });
  } catch (error) {
    const limited = rateLimitResponse(error, corsHeaders);
    if (limited) return limited;
    console.error('mock-interview-score error:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
