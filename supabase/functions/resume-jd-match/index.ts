import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_JD_LENGTH = 8000;

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

    const { resume_claims_id, jd_text } = await req.json();
    if (!resume_claims_id || !jd_text || typeof jd_text !== 'string' || !jd_text.trim()) {
      return new Response(
        JSON.stringify({ error: 'resume_claims_id and jd_text are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (jd_text.length > MAX_JD_LENGTH) {
      return new Response(
        JSON.stringify({ error: 'Job description is too long' }),
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
      .select('id, student_id, target_role, skills, certifications, projects')
      .eq('id', resume_claims_id)
      .maybeSingle();

    if (!resumeClaim || resumeClaim.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Resume claim not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `Compare this student's resume claims against a real job description, and score how well they match.

RESUME CLAIMS:
Target role: ${resumeClaim.target_role || 'not specified'}
Skills: ${(resumeClaim.skills || []).join(', ') || 'none listed'}
Certifications: ${(resumeClaim.certifications || []).join(', ') || 'none listed'}
Projects: ${JSON.stringify(resumeClaim.projects || [])}

JOB DESCRIPTION:
${jd_text.trim()}

Return ONLY a JSON object with this exact structure:
{
  "jd_title": "short inferred job title from the JD, e.g. 'Backend Engineer'",
  "match_score": 0,
  "matched_skills": ["skills/requirements from the JD that the student's claims actually cover"],
  "missing_skills": ["skills/requirements the JD asks for that the student's claims do NOT cover"],
  "suggestions": "2-3 sentences on what to add, learn, or emphasize to be a stronger match for this specific job"
}

Rules:
- match_score (0-100): how well the resume claims align with what THIS job description actually asks for — not a generic score.
- Only list skills that are explicitly implied by the JD text.
- Be specific and honest — if the match is weak, say so in suggestions.

Return ONLY the JSON object, no additional text, no markdown fences.`;

    let geminiResponse!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
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
        JSON.stringify({ error: 'Failed to analyze job match' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed: any;
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object found');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError, generatedText);
      return new Response(
        JSON.stringify({ error: 'Failed to parse job match analysis' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clampScore = (v: unknown) =>
      typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;

    const matchScore = clampScore(parsed.match_score);
    const matchedSkills = Array.isArray(parsed.matched_skills) ? parsed.matched_skills : [];
    const missingSkills = Array.isArray(parsed.missing_skills) ? parsed.missing_skills : [];
    const suggestions = typeof parsed.suggestions === 'string' ? parsed.suggestions : '';
    const jdTitle = typeof parsed.jd_title === 'string' ? parsed.jd_title : null;

    const { data: matchRow, error: insertError } = await supabase
      .from('resume_jd_matches')
      .insert({
        student_id: profile.id,
        resume_claims_id,
        jd_text: jd_text.trim(),
        jd_title: jdTitle,
        match_score: matchScore,
        matched_skills: matchedSkills,
        missing_skills: missingSkills,
        suggestions,
      })
      .select('id, created_at')
      .single();

    if (insertError || !matchRow) {
      console.error('Error saving JD match:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save job match result' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        id: matchRow.id,
        jd_title: jdTitle,
        match_score: matchScore,
        matched_skills: matchedSkills,
        missing_skills: missingSkills,
        suggestions,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-jd-match:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
