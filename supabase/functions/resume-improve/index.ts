import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    // Provider keys are resolved inside the shared helper (DeepSeek -> Gemini -> Kimi).

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

    const { data: claim, error: claimError } = await supabase
      .from('resume_claims')
      .select('id, student_id, target_role, skills, certifications, projects, resume_quality_notes, ats_match_notes, ats_match_score, resume_quality_score, resume_text, ai_improved_resume, improved_ats_score, improved_quality_score, improve_next_steps, improve_motivation, improved_at')
      .eq('id', resume_claims_id)
      .maybeSingle();

    if (claimError || !claim) {
      return new Response(
        JSON.stringify({ error: 'Resume claim not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (claim.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Owner's rules (18 Sep 2026): Auto-fix only for a resume under 60% ATS,
    // and only once per upload - the stored result is returned, never a second
    // AI call. One call rewrites AND re-scores AND writes next steps.
    const reply = (c: any) => new Response(JSON.stringify({
      success: true,
      improved_resume: c.ai_improved_resume,
      before_ats: c.ats_match_score, after_ats: c.improved_ats_score,
      before_quality: c.resume_quality_score, after_quality: c.improved_quality_score,
      next_steps: c.improve_next_steps ?? [], motivation: c.improve_motivation,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (claim.improved_at) return reply(claim);
    if ((claim.ats_match_score ?? 0) >= 60) {
      return new Response(
        JSON.stringify({ error: 'Your resume already scores 60% or more - follow the suggestions and start the assessment.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const source = claim.resume_text
      ? `ORIGINAL RESUME TEXT:
${claim.resume_text}`
      : `Target role: ${claim.target_role || 'not specified'}
Skills: ${(claim.skills || []).join(', ') || 'none listed'}
Certifications: ${(claim.certifications || []).join(', ') || 'none listed'}
Projects: ${JSON.stringify(claim.projects || [])}`;

    const prompt = `You are improving a student's resume for the target role "${claim.target_role || 'their target role'}".

${source}

Problems found when it was checked:
- Writing: ${claim.resume_quality_notes || 'none noted'}
- ATS match: ${claim.ats_match_notes || 'none noted'}

Do four things and return ONE JSON object:

1. "resume": rewrite the WHOLE resume as clean, ATS-friendly plain text. Keep the person's name, contact details, education, experience, projects, skills and certifications. Use ONLY facts in the original - never invent skills, employers, projects, numbers or dates. Fix the problems above. Section headers in CAPS (SUMMARY, SKILLS, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS). No markdown symbols, tables or columns. About one page.

2. Score YOUR rewritten resume with the same rubric the first check used:
   "resume_quality_score" (0-100): how well it is WRITTEN - clarity, structure, quantified impact, action verbs, no fluff, right length.
   "ats_match_score" (0-100): how well its keywords, skills and phrasing would pass an Applicant Tracking System scan for the target role - standard headers, keyword coverage for the role.
   Be honest: rewriting cannot add skills the person does not have, so a resume missing core skills for the role must still score low.

3. "next_steps": 3 to 5 clear, specific things the STUDENT should add or do themselves to raise the score further - things only they can supply (a missing skill the role needs, a number for a project result, a link, a certification). Each one short and concrete, naming the actual skill/section/project. Never generic advice like "improve your resume".

4. "motivation": one warm, genuine sentence (max 25 words) that recognises something real in their resume and encourages them to prove their skills in the assessment next.

Return ONLY: {"resume": "...", "resume_quality_score": 0, "ats_match_score": 0, "next_steps": ["..."], "motivation": "..."}`;

    let fix: { resume?: string; resume_quality_score?: number; ats_match_score?: number; next_steps?: string[]; motivation?: string } = {};
    try {
      const result = await generateText(prompt, { temperature: 0.3, maxOutputTokens: 3000 },
        { feature: 'resume-improve', userId: callerId, studentId: profile.id });
      const m = (result.text || '').match(/\{[\s\S]*\}/);
      fix = m ? JSON.parse(m[0]) : {};
    } catch (llmError) {
      console.error('Resume auto-fix failed:', llmError);
      const limited = rateLimitResponse(llmError, corsHeaders);
      if (limited) return limited;
      return new Response(
        JSON.stringify({ error: 'Failed to generate improved resume' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const score = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    if (!fix.resume || typeof fix.resume !== 'string') {
      return new Response(
        JSON.stringify({ error: 'The AI returned an empty resume - please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const saved = {
      ai_improved_resume: fix.resume.trim(),
      improved_ats_score: score(fix.ats_match_score),
      improved_quality_score: score(fix.resume_quality_score),
      improve_next_steps: (Array.isArray(fix.next_steps) ? fix.next_steps : []).slice(0, 5).map(String),
      improve_motivation: typeof fix.motivation === 'string' ? fix.motivation.slice(0, 300) : null,
      improved_at: new Date().toISOString(),
    };
    const { error: updateError } = await supabase.from('resume_claims').update(saved).eq('id', resume_claims_id);
    if (updateError) console.error('Error saving improved resume:', updateError);

    return reply({ ...claim, ...saved });

  } catch (error) {
    console.error('Error in resume-improve:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
