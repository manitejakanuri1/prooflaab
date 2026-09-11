import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { mayActOnStudentWork, forbidden } from "../_shared/authz.ts";

interface AuthorshipAnalysis {
  ai_authorship_risk: number;
  explanation: string;
  raw_model_output: any;
}

// Simple in-memory cache with TTL
const cache = new Map<string, { data: AuthorshipAnalysis; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
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

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { proof_id, code_snippets_or_repo_summary } = await req.json();

    if (!proof_id || !code_snippets_or_repo_summary) {
      return new Response(
        JSON.stringify({ error: 'proof_id and code_snippets_or_repo_summary are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ownership / role authorization: only the proof's owner or admin/college_admin may run this
    const supabaseForAuthz = createClient(supabaseUrl, supabaseKey);
    const callerId = claims.claims.sub;
    const { data: proofRow, error: proofErr } = await supabaseForAuthz
      .from('proof_uploads')
      .select('id, student_profiles!inner(user_id, college_id)')
      .eq('id', proof_id)
      .maybeSingle();
    if (proofErr || !proofRow) {
      return new Response(
        JSON.stringify({ error: 'Proof not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const ownerProfile = (proofRow as any).student_profiles;
    const allowed = await mayActOnStudentWork(supabaseForAuthz, callerId, {
      ownerUserId: ownerProfile?.user_id ?? null,
      collegeId: ownerProfile?.college_id ?? null,
    });
    if (!allowed) return forbidden(corsHeaders);

    console.log('Starting AI authorship analysis for proof:', proof_id);

    // Create cache key based on content hash using Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(code_snippets_or_repo_summary);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Check cache first
    const cached = cache.get(contentHash);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log('Cache hit for content hash:', contentHash);
      
      // Still save to database even if cached
      await supabase.from('ai_verifications').insert({
        proof_id,
        ai_authorship_risk: cached.data.ai_authorship_risk,
        explanation: cached.data.explanation,
        raw_model_output: cached.data.raw_model_output,
      });

      return new Response(
        JSON.stringify({
          success: true,
          cached: true,
          ...cached.data,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Construct the prompt for AI authorship detection
    const analysisPrompt = `You are an expert code analyst specializing in detecting AI-generated code patterns.

Analyze the following code for signs of AI authorship. Consider:

1. **AI-like Token Patterns:**
   - Overly verbose or boilerplate comments
   - Consistent naming conventions that are "too perfect"
   - Generic variable names (e.g., temp, data, result, response)
   - Excessive use of default patterns or template code
   - Lack of personal coding style quirks

2. **Stylistic Features:**
   - Uniform code formatting without personal variation
   - Consistent use of modern best practices without legacy patterns
   - Complete error handling in every function (unusual for human code)
   - Lack of code evolution (no refactoring marks, commented-out old code)
   - Perfect indentation and spacing throughout

3. **Evidence-Based Rationale:**
   - Provide specific code samples that support your assessment
   - Highlight patterns that indicate AI vs. human authorship
   - Note any unusual characteristics

Code to analyze:
\`\`\`
${code_snippets_or_repo_summary}
\`\`\`

Return your analysis in JSON format with:
{
  "ai_authorship_risk": <number 0-100>,
  "confidence_level": "<low|medium|high>",
  "explanation": "<detailed explanation of findings>",
  "evidence": [
    "<specific code sample or pattern 1>",
    "<specific code sample or pattern 2>"
  ],
  "human_indicators": [
    "<signs of human authorship if any>"
  ],
  "ai_indicators": [
    "<signs of AI authorship if any>"
  ]
}`;

    console.log('Analyzing authorship...');

    const { text: responseText, provider } = await generateText(analysisPrompt, {
      temperature: 0.2, // Lower temperature for more consistent analysis
      maxOutputTokens: 2048,
    }, { feature: 'ai-authorship' });
    console.log(`Authorship analysis via ${provider}`);

    if (!responseText) {
      throw new Error('No response text from the language model');
    }

    // Parse the JSON response from Gemini
    let analysis: any;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
      analysis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', responseText);
      throw new Error('Failed to parse AI analysis response');
    }

    // Validate and normalize the analysis
    const ai_authorship_risk = Math.max(0, Math.min(100, analysis.ai_authorship_risk || 0));
    const explanation = analysis.explanation || 'No explanation provided';

    const result: AuthorshipAnalysis = {
      ai_authorship_risk,
      explanation,
      raw_model_output: analysis,
    };

    // Cache the result
    cache.set(contentHash, {
      data: result,
      timestamp: Date.now(),
    });

    // Clean up old cache entries periodically
    if (cache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          cache.delete(key);
        }
      }
    }

    console.log('Analysis complete:', {
      ai_authorship_risk,
      confidence: analysis.confidence_level,
    });

    // Save to ai_verifications table
    const { data: verification, error: dbError } = await supabase
      .from('ai_verifications')
      .insert({
        proof_id,
        ai_authorship_risk,
        explanation,
        raw_model_output: analysis,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to save verification: ${dbError.message}`);
    }

    console.log('Verification saved:', verification.id);

    return new Response(
      JSON.stringify({
        success: true,
        cached: false,
        verification_id: verification.id,
        ai_authorship_risk,
        explanation,
        confidence_level: analysis.confidence_level,
        evidence: analysis.evidence,
        ai_indicators: analysis.ai_indicators,
        human_indicators: analysis.human_indicators,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('AI authorship analysis error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
