import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
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
      .select('id, student_id, target_role, skills, certifications, projects')
      .eq('id', resume_claims_id)
      .maybeSingle();

    if (!resumeClaim || resumeClaim.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Resume claim not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `A student is targeting "${resumeClaim.target_role || 'a software role'}".

Their claimed skills: ${(resumeClaim.skills || []).join(', ') || 'none listed'}
Their existing certifications: ${(resumeClaim.certifications || []).join(', ') || 'none listed'}
Their projects: ${JSON.stringify(resumeClaim.projects || [])}

Suggest 4-6 REAL, well-known, currently-offered certifications (from actual providers like AWS, Google Cloud, Microsoft, Meta, HashiCorp, Coursera-partnered universities, CompTIA, etc.) that would meaningfully strengthen this specific student's profile for this specific target role.

Rules:
- Do NOT suggest a certification they already have (case-insensitive match against their existing list, including close variants).
- Prioritize certifications that fill an actual gap between their current skills and what the target role typically requires.
- Each suggestion needs a real, correct provider and name — do not invent fictional certifications.
- Rank by priority: "high" (directly closes an important gap), "medium" (strengthens an existing strength), "low" (nice-to-have, resume padding).

Return ONLY a JSON array with this exact structure:
[
  {
    "name": "exact certification name",
    "provider": "issuing organization",
    "priority": "high",
    "why": "one sentence on why this specific student should get this, tied to their gap or goal"
  }
]

Return ONLY the JSON array, no additional text, no markdown fences.`;

    let generatedText: string;
    try {
      // Cached: which certificates are worth doing for a given role and skill
      // set does not change between students. This is the same question asked
      // over and over by different people.
      const result = await generateText(prompt, { temperature: 0.4, maxOutputTokens: 3000, cache: true }, { feature: 'resume-cert-radar' });
      generatedText = result.text;
    } catch (e) {
      console.error('LLM call failed:', e);
      // Over-budget callers get a 429 with Retry-After, not a generic failure,
      // so the client can tell 'wait' apart from 'broken'.
      const limited = rateLimitResponse(e, corsHeaders);
      if (limited) return limited;
      return new Response(
        JSON.stringify({ error: 'Failed to generate certification suggestions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let suggestions: any[];
    try {
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      suggestions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError, generatedText);
      return new Response(
        JSON.stringify({ error: 'Failed to parse certification suggestions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: row, error: insertError } = await supabase
      .from('resume_cert_suggestions')
      .insert({
        student_id: profile.id,
        resume_claims_id,
        suggestions,
      })
      .select('id, created_at')
      .single();

    if (insertError || !row) {
      console.error('Error saving cert suggestions:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save certification suggestions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: row.id, suggestions }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-cert-radar:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
