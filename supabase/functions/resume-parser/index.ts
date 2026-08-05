import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 5MB — matches the client-side limit shown to students on the upload screen.
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/**
 * Pull the visible text out of a .docx.
 *
 * PDFs are read in the browser by pdf.js, but a DOCX arriving without text has
 * to be flattened here. A .docx is a ZIP whose word/document.xml holds the body,
 * where <w:p> is a paragraph and <w:tab/> a tab.
 */
function extractDocxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const documentXml = files['word/document.xml'];
  if (!documentXml) {
    throw new Error('DOCX is missing word/document.xml');
  }

  const xml = new TextDecoder().decode(documentXml);

  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    // Provider keys are resolved inside the shared helper (DeepSeek -> Gemini -> Kimi).

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

    // resume_text is extracted in the browser by pdf.js and passed in. That is
    // what lets a text-only model (DeepSeek) handle PDFs at all — it cannot read
    // a PDF itself. Without it we fall back to reading the file server-side.
    const { storage_path, resume_text } = await req.json();
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

    const isPdf = /\.pdf$/i.test(storage_path);
    const isDocx = /\.docx$/i.test(storage_path);
    if (!isPdf && !isDocx) {
      return new Response(
        JSON.stringify({ error: 'Only PDF or DOCX resumes are supported' }),
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

    // Resolve the resume down to plain text. Preference order:
    //   1. resume_text from the browser (pdf.js) — no download needed at all
    //   2. DOCX unzipped server-side
    //   3. PDF bytes handed to a multimodal model as a last resort
    let resumeText = typeof resume_text === 'string' ? resume_text.trim() : '';
    let fileBytes: Uint8Array | null = null;

    if (!resumeText) {
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
          JSON.stringify({ error: 'Resume file is too large (5MB max)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      fileBytes = new Uint8Array(await fileBlob.arrayBuffer());

      if (isDocx) {
        try {
          resumeText = extractDocxText(fileBytes);
        } catch (err) {
          console.error('DOCX extraction failed:', err);
          return new Response(
            JSON.stringify({ error: 'Could not read that DOCX. Try exporting it as a PDF.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    if (resumeText.length < 30) {
      return new Response(
        JSON.stringify({
          error: isDocx
            ? 'That DOCX appears to be empty.'
            : 'Could not read any text from that resume. Try a clearer file.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `You are analyzing a student's resume to extract exactly what they claim about themselves — no more, no less.

Read the resume and return ONLY the skills, certifications, projects, and target role that are actually written in it. Do not invent, assume, or add anything not present in the document.

For each project listed, capture its name, a one-sentence description of what it does (from the resume text), and the tech stack/tools mentioned for it.

If a target job role/title is not explicitly stated, infer the single most likely one from the resume's overall content (most recent role sought, objective line, or dominant skill area) rather than leaving it empty.

Also score the resume itself on two separate dimensions:
1. "resume_quality_score" (0-100): how well the resume is WRITTEN — clarity, structure, quantified impact (numbers/results, not just duties), action verbs, no fluff, appropriate length. This has nothing to do with how skilled the person is, only how well it's communicated.
2. "ats_match_score" (0-100): how well the resume's keywords, skills, and phrasing would match a typical Applicant Tracking System scan for the inferred target role — standard section headers, keyword density for the role, no images/tables that break parsing (assume text-only scan).

Also write "skill_relevance_notes": regardless of the scores above, independently judge whether the specific skills and certifications claimed are actually valuable and relevant to the inferred target role right now (not outdated, not filler, not disconnected from what the role needs), and suggest what to focus on next. Two or three sentences. This is used only when the resume already scores very well, to tell a student who's already ATS-ready what to do next.

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
  "ats_match_notes": "one or two sentences on what to improve",
  "skill_relevance_notes": "two or three sentences on whether the skills/certs are actually valuable and what to focus on next"
}

Return ONLY the JSON object, no additional text, no markdown code fences.`;

    // Everything arrives here as plain text — PDFs are read (and scans OCR'd) in
    // the browser, DOCX is unzipped above. Nothing needs a model that can see
    // images, so this runs entirely through the shared helper.
    let generatedText = '';
    try {
      const result = await generateText(`${prompt}\n\nRESUME TEXT:\n${resumeText}`, {
        temperature: 0.2,
        maxOutputTokens: 4000,
      }, { feature: 'resume-parser', userId: callerId, studentId: profile.id });
      generatedText = result.text;
      console.log(`Resume extracted via ${result.provider}`);
    } catch (llmError) {
      console.error('All LLM providers failed:', llmError);
      // Over-budget callers get a 429 with Retry-After, not a generic failure,
      // so the client can tell 'wait' apart from 'broken'.
      const limited = rateLimitResponse(llmError, corsHeaders);
      if (limited) return limited;
      return new Response(
        JSON.stringify({ error: 'Failed to analyze resume' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let extraction: {
      target_role?: string;
      skills?: string[];
      certifications?: string[];
      projects?: { name: string; description: string; tech_stack: string[] }[];
      resume_quality_score?: number;
      resume_quality_notes?: string;
      ats_match_score?: number;
      ats_match_notes?: string;
      skill_relevance_notes?: string;
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
    const skill_relevance_notes = typeof extraction.skill_relevance_notes === 'string' ? extraction.skill_relevance_notes : null;

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
        skill_relevance_notes,
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
        skill_relevance_notes,
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
