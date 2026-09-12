import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";

// Skills claimed on a resume, mapped to a Piston-executable language. First match wins.
const LANGUAGE_MAP: Record<string, string> = {
  python: 'python', java: 'java', javascript: 'javascript', typescript: 'typescript',
  'c++': 'cpp', cpp: 'cpp', c: 'c', go: 'go', golang: 'go', ruby: 'ruby', php: 'php',
};

function pickLanguage(skills: string[]): string {
  for (const skill of skills) {
    const key = skill.toLowerCase().trim();
    if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
  }
  return 'python';
}

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

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

    // Same two ways in as the quiz: a resume, or the interests a student picked
    // after pressing Skip. Exactly one.
    const { resume_claims_id, student_interest_id } = await req.json();
    if (!resume_claims_id === !student_interest_id) {
      return new Response(
        JSON.stringify({ error: 'send exactly one of resume_claims_id or student_interest_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    const fromResume = Boolean(resume_claims_id);

    const { data: resumeClaim } = fromResume
      ? await supabase
          .from('resume_claims')
          .select('id, student_id, skills, target_role, projects')
          .eq('id', resume_claims_id)
          .maybeSingle()
      : await supabase
          .from('student_interests')
          .select('id, student_id, skills, interests, target_role')
          .eq('id', student_interest_id)
          .maybeSingle()
          .then(({ data }) => ({
            data: data
              ? {
                  id: data.id,
                  student_id: data.student_id,
                  // Interests are the skills for this student — pickLanguage
                  // reads this list to choose the coding language.
                  skills: [...(data.skills || []), ...(data.interests || [])],
                  target_role: data.target_role,
                  projects: [],
                }
              : null,
          }));

    if (!resumeClaim || resumeClaim.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: fromResume ? 'Resume claim not found' : 'Interests not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: assessment } = await supabase
      .from('resume_assessments')
      .select('id, student_id')
      .eq(fromResume ? 'resume_claims_id' : 'student_interest_id', fromResume ? resume_claims_id : student_interest_id)
      .maybeSingle();

    if (!assessment || assessment.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Complete the quiz before the coding round' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const skills: string[] = resumeClaim.skills || [];
    const language = pickLanguage(skills);
    const targetRole = resumeClaim.target_role || 'a software role';

    const prompt = `Write 2 short, self-contained coding problems in ${language} for a student targeting "${targetRole}" who claims these skills: ${skills.join(', ') || 'general programming'}.

Rules:
- Each problem must be solvable in under 15 lines of ${language}.
- Each problem is a single function the student completes — give a starter code stub with the function signature and a "# your code here" / "// your code here" placeholder, nothing else implemented.
- Each problem needs exactly 3 test cases: stdin input (what gets read via standard input, matching how the starter code reads input) and the exact expected stdout output.
- The starter code MUST read input from stdin and print the result to stdout (not just return it), so test cases can be checked by comparing printed output.
- Difficulty: easy, solvable in a few minutes.
- Test cases must be deterministic (no randomness, no current time/date).
- IMPORTANT execution environment constraints:
  - If ${language} is java: do NOT use "public class" — the class must be declared WITHOUT the public modifier (e.g. "class Solution { public static void main(String[] args) { ... } }"), otherwise it fails to compile in the sandbox.
  - If ${language} is javascript: read stdin with exactly this pattern: const input = require('fs').readFileSync(0, 'utf-8').trim(); — do not use readline or process.stdin events.

Return ONLY a JSON array with this exact structure:
[
  {
    "id": "c1",
    "language": "${language}",
    "prompt": "problem statement",
    "starter_code": "starter code as a single string with \\n for newlines",
    "test_cases": [
      { "stdin": "input1", "expected_output": "output1" },
      { "stdin": "input2", "expected_output": "output2" },
      { "stdin": "input3", "expected_output": "output3" }
    ]
  },
  { "id": "c2", ... same structure }
]

Return ONLY the JSON array, no additional text, no markdown fences.`;

    // Coding problems depend only on the skills and the target role, so two
    // students with the same profile were paying for the same two problems
    // twice. Keyed on a normalised, sorted skill list, so "Node.js, React" and
    // "react, nodejs" are recognised as the same profile.
    const { data: keyRow } = await supabase.rpc('template_key', {
      _kind: 'coding_round', _role: targetRole, _skills: skills, _extra: language,
    });
    const cacheKey = keyRow as unknown as string | null;

    let codingQuestions: any[] | null = null;

    if (cacheKey) {
      const { data: cached } = await supabase
        .from('ai_templates')
        .select('payload')
        .eq('template_key', cacheKey)
        .maybeSingle();

      if (cached?.payload) {
        console.log('coding round served from template cache:', cacheKey);
        codingQuestions = cached.payload as any[];
        await supabase.rpc('touch_template', { _key: cacheKey });
      }
    }

    let generatedText: string;
    if (codingQuestions) {
      generatedText = '';
    } else {
    try {
      const result = await generateText(prompt, { temperature: 0.5, maxOutputTokens: 3000 }, { feature: 'resume-coding-generate', userId: callerId, studentId: profile.id });
      generatedText = result.text;
    } catch (e) {
      console.error('LLM call failed:', e);
      // Over-budget callers get a 429 with Retry-After, not a generic failure,
      // so the client can tell 'wait' apart from 'broken'.
      const limited = rateLimitResponse(e, corsHeaders);
      if (limited) return limited;
      return new Response(
        JSON.stringify({ error: 'Failed to generate coding problems' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      codingQuestions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse the generated coding problems:', parseError, generatedText);
      return new Response(
        JSON.stringify({ error: 'Failed to parse generated coding problems' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cached only after it parsed. Storing a broken payload would serve the
    // same broken payload to everyone who follows.
    if (cacheKey && codingQuestions) {
      await supabase.from('ai_templates').upsert({
        template_key: cacheKey,
        kind: 'coding_round',
        role: targetRole,
        paths: skills,
        payload: codingQuestions,
      }, { onConflict: 'template_key' });
    }
    }

    if (!codingQuestions) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate coding problems' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: updateError } = await supabase
      .from('resume_assessments')
      .update({ coding_questions: codingQuestions })
      .eq('id', assessment.id);

    if (updateError) {
      console.error('Error saving coding questions:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save coding problems' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only the first test case is shown to the student as a sample; the rest
    // stay server-side and are only used for grading in resume-code-execute.
    const publicQuestions = codingQuestions.map((q: any) => ({
      id: q.id,
      language: q.language,
      prompt: q.prompt,
      starter_code: q.starter_code,
      sample_test: q.test_cases?.[0] || null,
    }));

    return new Response(
      JSON.stringify({ success: true, assessment_id: assessment.id, questions: publicQuestions }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-coding-generate:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
