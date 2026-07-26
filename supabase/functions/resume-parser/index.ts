import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESUME_BYTES = 8 * 1024 * 1024; // 8MB — well under Gemini's inline-data limit

function bytesToBase64(bytes: Uint8Array): string {
  // btoa(String.fromCharCode(...bytes)) blows the call stack on large files —
  // build the binary string in chunks instead.
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

    // Authenticate the caller
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

    const { storage_path } = await req.json();
    if (!storage_path || typeof storage_path !== 'string') {
      return new Response(
        JSON.stringify({ error: 'storage_path is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // storage_path must live inside the caller's own folder — students upload to
    // `resumes/{their user id}/...`, so this stops one student parsing another's file.
    if (!storage_path.startsWith(`${callerId}/`)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!/\.pdf$/i.test(storage_path)) {
      return new Response(
        JSON.stringify({ error: 'Only PDF resumes are supported right now' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile, error: profileError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', callerId)
      .maybeSingle();
    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'Student profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: fileBlob, error: downloadError } = await supabase
      .storage
      .from('resumes')
      .download(storage_path);
    if (downloadError || !fileBlob) {
      console.error('Resume download failed:', downloadError);
      return new Response(
        JSON.stringify({ error: 'Could not read uploaded resume' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (fileBlob.size > MAX_RESUME_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Resume file is too large (8MB max)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fileBytes = new Uint8Array(await fileBlob.arrayBuffer());
    const base64File = bytesToBase64(fileBytes);

    const prompt = `You are analyzing a student's resume (attached as a PDF) to extract exactly what they claim about themselves — no more, no less.

Read the resume and return ONLY the skills, certifications, projects, and target role that are actually written in it. Do not invent, assume, or add anything not present in the document.

For each project listed, capture its name, a one-sentence description of what it does (from the resume text), and the tech stack/tools mentioned for it.

If a target job role/title is not explicitly stated, infer the single most likely one from the resume's overall content (most recent role sought, objective line, or dominant skill area) rather than leaving it empty.

Also score the resume itself on two separate dimensions:
1. "resume_quality_score" (0-100): how well the resume is WRITTEN — clarity, structure, quantified impact (numbers/results, not just duties), action verbs, no fluff, appropriate length. This has nothing to do with how skilled the person is, only how well it's communicated.
2. "ats_match_score" (0-100): how well the resume's keywords, skills, and phrasing would match a typical Applicant Tracking System scan for the inferred target role — standard section headers, keyword density for the role, no images/tables that break parsing (assume text-only scan).

Return a JSON object with this exact structure:
{
  "target_role": "string",
  "skills": ["skill1", "skill2"],
  "certifications": ["cert1", "cert2"],
  "projects": [
    { "name": "string", "description": "string", "tech_stack": ["tech1", "tech2"] }
  ],
  "resume_quality_score": 0,
  "resume_quality_notes": "one or two sentences on what to improve",
  "ats_match_score": 0,
  "ats_match_notes": "one or two sentences on what to improve"
}

Return ONLY the JSON object, no additional text, no markdown code fences.`;

    console.log('Calling Gemini API for resume extraction...');

    // Gemini returns transient 429/503 under load — retry twice with backoff
    let geminiResponse!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: 'application/pdf', data: base64File } },
                { text: prompt }
              ]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4000,
            }
          })
        }
      );
      if (geminiResponse.ok || ![429, 503].includes(geminiResponse.status)) break;
      console.log(`Gemini ${geminiResponse.status}, retry ${attempt + 1}...`);
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);

      if (geminiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Failed to analyze resume' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log('Gemini response:', generatedText);

    let extraction: {
      target_role?: string;
      skills?: string[];
      certifications?: string[];
      projects?: { name: string; description: string; tech_stack: string[] }[];
      resume_quality_score?: number;
      resume_quality_notes?: string;
      ats_match_score?: number;
      ats_match_notes?: string;
    };
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in response');
      }
      extraction = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError);
      return new Response(
        JSON.stringify({ error: 'Failed to parse resume analysis' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const skills = Array.isArray(extraction.skills) ? extraction.skills : [];
    const certifications = Array.isArray(extraction.certifications) ? extraction.certifications : [];
    const projects = Array.isArray(extraction.projects) ? extraction.projects : [];
    const target_role = typeof extraction.target_role === 'string' ? extraction.target_role : null;
    const clampScore = (v: unknown) =>
      typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
    const resume_quality_score = clampScore(extraction.resume_quality_score);
    const resume_quality_notes = typeof extraction.resume_quality_notes === 'string' ? extraction.resume_quality_notes : null;
    const ats_match_score = clampScore(extraction.ats_match_score);
    const ats_match_notes = typeof extraction.ats_match_notes === 'string' ? extraction.ats_match_notes : null;

    const { data: claimRow, error: insertError } = await supabase
      .from('resume_claims')
      .insert({
        student_id: profile.id,
        storage_path,
        target_role,
        skills,
        certifications,
        projects,
        raw_extraction: extraction,
        status: 'extracted',
        resume_quality_score,
        resume_quality_notes,
        ats_match_score,
        ats_match_notes,
      })
      .select('id')
      .single();

    if (insertError || !claimRow) {
      console.error('Error saving resume claims:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save extracted resume data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Successfully extracted and saved resume claims:', claimRow.id);

    return new Response(
      JSON.stringify({
        success: true,
        resume_claim_id: claimRow.id,
        target_role,
        skills,
        certifications,
        projects,
        resume_quality_score,
        resume_quality_notes,
        ats_match_score,
        ats_match_notes,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-parser:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
