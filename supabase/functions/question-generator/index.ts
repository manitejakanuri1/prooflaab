import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const githubPat = Deno.env.get('GITHUB_PAT');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

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

    const { proof_id, repo_url, top_n = 3 } = await req.json();

    if (!proof_id || !repo_url) {
      return new Response(
        JSON.stringify({ error: 'proof_id and repo_url are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Generating questions for proof:', proof_id, 'repo:', repo_url);

    // Extract owner and repo from URL
    const repoMatch = repo_url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      return new Response(
        JSON.stringify({ error: 'Invalid GitHub repo URL format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const [, owner, repoName] = repoMatch;
    const cleanRepoName = repoName.replace(/\.git$/, '');

    // Fetch repo structure and recent commits. An expired GITHUB_PAT turns
    // public-repo requests into 401s, so retry unauthenticated on failure.
    const baseHeaders: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Supabase-Edge-Function'
    };
    const ghFetch = async (url: string) => {
      if (githubPat) {
        const authed = await fetch(url, { headers: { ...baseHeaders, 'Authorization': `token ${githubPat}` } });
        if (authed.ok) return authed;
      }
      return fetch(url, { headers: baseHeaders });
    };

    // Get repo tree (fall back to the repo's default branch if main is absent)
    let treeResponse = await ghFetch(
      `https://api.github.com/repos/${owner}/${cleanRepoName}/git/trees/main?recursive=1`
    );
    if (!treeResponse.ok) {
      const repoInfo = await ghFetch(`https://api.github.com/repos/${owner}/${cleanRepoName}`);
      if (repoInfo.ok) {
        const { default_branch } = await repoInfo.json();
        if (default_branch && default_branch !== 'main') {
          treeResponse = await ghFetch(
            `https://api.github.com/repos/${owner}/${cleanRepoName}/git/trees/${default_branch}?recursive=1`
          );
        }
      }
    }

    if (!treeResponse.ok) {
      console.error('GitHub tree fetch failed:', await treeResponse.text());
      return new Response(
        JSON.stringify({ error: 'Failed to fetch repository tree from GitHub' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const treeData = await treeResponse.json();

    // Get recent commits
    const commitsResponse = await ghFetch(
      `https://api.github.com/repos/${owner}/${cleanRepoName}/commits?per_page=10`
    );

    const commits = commitsResponse.ok ? await commitsResponse.json() : [];

    // Prepare context for Gemini
    const fileStructure = treeData.tree
      .filter((item: any) => item.type === 'blob')
      .map((item: any) => item.path)
      .slice(0, 50); // Limit to 50 files

    const recentCommitMessages = commits
      .slice(0, 5)
      .map((c: any) => `- ${c.commit.message} (${c.sha.substring(0, 7)})`)
      .join('\n');

    // Generate questions using Gemini
    const prompt = `You are an expert code reviewer analyzing a GitHub repository for educational assessment.

Repository: ${owner}/${cleanRepoName}
File structure (sample):
${fileStructure.slice(0, 30).join('\n')}

Recent commits:
${recentCommitMessages}

Generate exactly ${top_n} multiple-choice questions to assess the developer's understanding of this codebase. Each question should:
1. Focus on design choices, language/library purpose, or how the pieces fit together
2. Reference specific files, commits, or patterns visible in the structure
3. Be answerable in under 15 seconds by someone who truly wrote/understood the code
4. Have exactly 4 options with exactly one correct answer; wrong options must be plausible
5. Vary in difficulty (mix of easy and medium)

Each question also carries learning content shown to the student AFTER they answer:
- "reinforce": 1-2 sentences shown when they answer correctly, confirming WHY that answer is right
- "teach": shown when they answer wrongly. Written in simple, beginner-friendly English (no jargon without explanation). It must cover: what programming language/framework this part of the code uses and why it fits here, what the relevant dependency/library does, and the key syntax or concept the question tested — so the student understands the code they wrote or copied.

Return a JSON array with this exact structure:
[
  {
    "id": "q1",
    "prompt": "Question text here",
    "options": ["option A", "option B", "option C", "option D"],
    "correct_index": 0,
    "reinforce": "Correct because ...",
    "teach": "This project uses ... The library ... The syntax ... ",
    "context_references": ["file.js line 45", "commit abc123"],
    "difficulty": "easy|medium",
    "time_limit_seconds": 15
  }
]

Return ONLY the JSON array, no additional text.`;

    console.log('Calling Gemini API for question generation...');

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4000,
          }
        })
      }
    );

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
        JSON.stringify({ error: 'Failed to generate questions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log('Gemini response:', generatedText);

    // Parse questions from response
    let questions;
    try {
      // Extract JSON array from response (handle markdown code blocks)
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }
      questions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError);
      return new Response(
        JSON.stringify({ error: 'Failed to parse generated questions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure we have the right number of questions
    questions = questions.slice(0, top_n);

    // Save to conceptual_tests table
    const { data: existingTest, error: fetchError } = await supabase
      .from('conceptual_tests')
      .select('id')
      .eq('proof_id', proof_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error checking existing test:', fetchError);
    }

    if (existingTest) {
      // Update existing test
      const { error: updateError } = await supabase
        .from('conceptual_tests')
        .update({
          questions,
          status: 'pending',
        })
        .eq('proof_id', proof_id);

      if (updateError) {
        console.error('Error updating conceptual test:', updateError);
        return new Response(
          JSON.stringify({ error: 'Failed to save questions' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Create new test
      const { error: insertError } = await supabase
        .from('conceptual_tests')
        .insert({
          proof_id,
          questions,
          status: 'pending',
          student_answers: [],
          answer_scores: []
        });

      if (insertError) {
        console.error('Error creating conceptual test:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to save questions' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('Successfully generated and saved questions');

    return new Response(
      JSON.stringify({
        success: true,
        questions,
        proof_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in question-generator:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
