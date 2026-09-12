import { serve } from "../_shared/serve.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from "../_shared/rate-limit.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";

/**
 * Four interview questions for the student's own target role, generated once
 * per attempt rather than drawn from a fixed bank — the roadmap already knows
 * what they claim to know, so the questions can be specific instead of generic.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsStatic, 'Content-Type': 'application/json' },
  });

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

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id, target_role, branch')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile) return json({ error: 'Student profile not found' }, 404);

    const role = profile.target_role || profile.branch || 'Software Engineer';

    const { data: skillRows } = await supabase
      .from('student_skills')
      .select('skill, status')
      .eq('student_id', profile.id)
      .eq('status', 'proven')
      .limit(8);
    const provenSkills = (skillRows ?? []).map((s) => s.skill);

    const prompt = `You are interviewing a candidate for the role of "${role}".
${provenSkills.length ? `They have proven (not just claimed) these skills: ${provenSkills.join(', ')}.` : ''}

Write exactly 4 interview questions a real interviewer would ask for this role:
1. One about a specific technical concept core to the role.
2. One "walk me through a project" style question.
3. One behavioural question (teamwork, conflict, a mistake and what changed after).
4. One "why this role / where do you want to grow" question.

Keep each question one or two sentences, spoken out loud by an interviewer — not a written exam question.

Return ONLY JSON: {"questions": ["q1", "q2", "q3", "q4"]}`;

    let questions: string[];
    try {
      const { text } = await generateText(prompt, { temperature: 0.6, maxOutputTokens: 500 },
        { feature: 'mock-interview-generate', studentId: profile.id });
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text);
      questions = Array.isArray(parsed.questions) ? parsed.questions.filter((q: unknown) => typeof q === 'string') : [];
      if (questions.length < 4) throw new Error('short question list');
      questions = questions.slice(0, 4);
    } catch (e) {
      console.error('mock-interview-generate: could not write questions', e);
      return json({ error: 'Could not prepare interview questions. Please try again.' }, 502);
    }

    const { data: row, error: insErr } = await supabase
      .from('mock_interviews')
      .insert({ student_id: profile.id, target_role: role, questions, status: 'answering' })
      .select('id')
      .single();
    if (insErr) throw insErr;

    return json({ interview_id: row.id, questions });
  } catch (error) {
    const limited = rateLimitResponse(error, corsHeaders);
    if (limited) return limited;
    console.error('mock-interview-generate error:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
