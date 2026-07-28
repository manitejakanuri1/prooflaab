import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { resume_claims_id } = await req.json();
    if (!resume_claims_id) {
      return new Response(
        JSON.stringify({ error: 'resume_claims_id is required' }),
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

    const { data: resumeClaim } = await supabase
      .from('resume_claims')
      .select('id, student_id, skills, target_role, projects')
      .eq('id', resume_claims_id)
      .maybeSingle();

    if (!resumeClaim || resumeClaim.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Resume claim not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: assessment } = await supabase
      .from('resume_assessments')
      .select('id, student_id')
      .eq('resume_claims_id', resume_claims_id)
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

    let geminiResponse!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 3000 }
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
        JSON.stringify({ error: 'Failed to generate coding problems' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let codingQuestions: any[];
    try {
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      codingQuestions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError, generatedText);
      return new Response(
        JSON.stringify({ error: 'Failed to parse generated coding problems' }),
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
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
