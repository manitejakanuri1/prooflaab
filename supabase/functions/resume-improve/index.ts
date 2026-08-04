import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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
      .select('id, student_id, target_role, skills, certifications, projects, resume_quality_notes, ats_match_notes')
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

    const prompt = `Rewrite this student's resume into a clean, ATS-friendly plain-text resume, fixing the specific flaws noted below. Use ONLY the facts given — do not invent new skills, projects, or experience.

Target role: ${claim.target_role || 'not specified'}
Skills: ${(claim.skills || []).join(', ') || 'none listed'}
Certifications: ${(claim.certifications || []).join(', ') || 'none listed'}
Projects: ${JSON.stringify(claim.projects || [])}

Writing quality flaws to fix: ${claim.resume_quality_notes || 'none noted'}
ATS match flaws to fix: ${claim.ats_match_notes || 'none noted'}

Rules:
- Plain text only, no markdown symbols, section headers in CAPS (SUMMARY, SKILLS, PROJECTS, CERTIFICATIONS).
- Quantify impact where the project description implies a result, but never fabricate numbers not implied by the given facts.
- Keep it to roughly one page worth of text.
- Standard ATS-safe formatting: no tables, no columns, no special characters.

Return ONLY the resume text, nothing else.`;

    // json: false — this one returns resume prose, not a JSON blob.
    let improvedResume: string;
    try {
      const result = await generateText(prompt, {
        temperature: 0.4,
        maxOutputTokens: 2000,
        json: false,
      });
      improvedResume = (result.text || '').trim();
    } catch (llmError) {
      console.error('All LLM providers failed:', llmError);
      return new Response(
        JSON.stringify({ error: 'Failed to generate improved resume' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!improvedResume) {
      return new Response(
        JSON.stringify({ error: 'Gemini returned an empty resume' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: updateError } = await supabase
      .from('resume_claims')
      .update({ ai_improved_resume: improvedResume })
      .eq('id', resume_claims_id);

    if (updateError) {
      console.error('Error saving improved resume:', updateError);
    }

    return new Response(
      JSON.stringify({ success: true, improved_resume: improvedResume }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-improve:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
