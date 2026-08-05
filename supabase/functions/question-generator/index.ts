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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const githubPat = Deno.env.get('GITHUB_PAT');

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

    // No per-provider key check here: the shared helper picks whichever of
    // DeepSeek/Gemini/Kimi is configured and throws only if all are missing.

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Ownership / role authorization + repo_url must match stored proof.file_url
    const callerId = claims.claims.sub;
    const { data: proofRow, error: proofErr } = await supabase
      .from('proof_uploads')
      .select('id, file_url, student_profiles!inner(user_id)')
      .eq('id', proof_id)
      .maybeSingle();
    if (proofErr || !proofRow) {
      return new Response(
        JSON.stringify({ error: 'Proof not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const ownerId = (proofRow as any).student_profiles?.user_id;
    if (ownerId !== callerId) {
      const { data: roles } = await supabase
        .from('user_roles').select('role').eq('user_id', callerId);
      const allowed = (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'college_admin');
      if (!allowed) {
        return new Response(
          JSON.stringify({ error: 'Forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    if (!proofRow.file_url || proofRow.file_url !== repo_url) {
      return new Response(
        JSON.stringify({ error: 'repo_url does not match the proof record' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
    let treeBranch = 'main';
    let treeResponse = await ghFetch(
      `https://api.github.com/repos/${owner}/${cleanRepoName}/git/trees/main?recursive=1`
    );
    if (!treeResponse.ok) {
      const repoInfo = await ghFetch(`https://api.github.com/repos/${owner}/${cleanRepoName}`);
      if (repoInfo.ok) {
        const { default_branch } = await repoInfo.json();
        if (default_branch && default_branch !== 'main') {
          treeBranch = default_branch;
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

    // Fetch actual source of a few key files so questions are grounded in
    // real code, not guessed from file names and commit messages.
    const codeExtensions = /\.(html|js|jsx|ts|tsx|py|css|json|md|java|c|cpp|go|rs)$/i;
    const candidateFiles = fileStructure
      .filter((p: string) => codeExtensions.test(p) && !/lock|min\.|node_modules|dist\//i.test(p))
      .sort((a: string, b: string) => a.split('/').length - b.split('/').length)
      .slice(0, 4);

    const fileContents: string[] = [];
    for (const path of candidateFiles) {
      try {
        const raw = await fetch(
          `https://raw.githubusercontent.com/${owner}/${cleanRepoName}/${treeBranch}/${path}`
        );
        if (raw.ok) {
          const text = await raw.text();
          fileContents.push(`=== ${path} ===\n${text.slice(0, 3000)}`);
        }
      } catch (_e) { /* skip unreadable files */ }
    }

    // Generate questions using Gemini
    const prompt = `You are an expert code reviewer analyzing a GitHub repository for educational assessment.

Repository: ${owner}/${cleanRepoName}
File structure (sample):
${fileStructure.slice(0, 30).join('\n')}

Recent commits:
${recentCommitMessages}

Actual source code from the repository:
${fileContents.join('\n\n') || '(no file contents available — base questions only on facts visible in the file structure)'}

Generate exactly ${top_n} multiple-choice questions to assess the developer's understanding of this codebase. Each question MUST:
1. Be based ONLY on the actual source code shown above — never guess or invent what a file, library, or commit might mean. If you are not certain a fact is true from the code, do not ask about it.
2. Be ONE short, plain-English sentence (under 25 words). No commit hashes, no long quotes, no jargon without need.
3. Test understanding of what the code DOES or WHY it is written that way — the kind of thing only someone who read their own code would know.
4. Be answerable in under 15 seconds by someone who truly wrote/understood the code
5. Have exactly 4 options with exactly one correct answer; wrong options must be plausible
6. Vary in difficulty (mix of easy and medium)

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
    "time_limit_seconds": 30
  }
]

Return ONLY the JSON array, no additional text.`;

    console.log('Generating questions...');

    // Provider choice, key handling and retry/backoff all live in the shared
    // helper: DeepSeek -> Gemini -> Kimi.
    let generatedText: string;
    try {
      const result = await generateText(prompt, { temperature: 0.7, maxOutputTokens: 4000 }, { feature: 'question-generator' });
      generatedText = result.text;
      console.log(`Questions generated via ${result.provider}`);
    } catch (llmError) {
      console.error('All LLM providers failed:', llmError);
      return new Response(
        JSON.stringify({ error: 'Failed to generate questions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Shuffle option order — LLMs put the correct answer first far too often
    for (const q of questions) {
      if (Array.isArray(q.options) && typeof q.correct_index === 'number') {
        const correctText = q.options[q.correct_index];
        for (let i = q.options.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
        }
        q.correct_index = q.options.indexOf(correctText);
      }
    }

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
