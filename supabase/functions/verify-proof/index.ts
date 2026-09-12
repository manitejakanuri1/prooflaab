import { serve } from "../_shared/serve.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { generateText } from "../_shared/llm.ts";
import { cors } from "../_shared/cors.ts";
import { mayActOnStudentWork, forbidden } from "../_shared/authz.ts";

interface GitHubRepoInfo {
  commit_count: number;
  last_commit_date: string;
  unique_contributors: number;
  authenticity_score: number;
}

interface VerificationResult {
  proofId: string;
  moss_score?: number;
  originality_score: number;
  authenticity_score: number;
  trust_change: number;
  review_comment: string;
  auto_verified: boolean;
}

async function verifyGitHubRepo(repoUrl: string, githubPat: string): Promise<GitHubRepoInfo | null> {
  try {
    console.log('Verifying GitHub repo:', repoUrl);
    
    // Extract owner and repo from GitHub URL
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      console.error('Invalid GitHub URL format');
      return null;
    }

    const [, owner, repo] = match;
    const cleanRepo = repo.replace('.git', '');

    // Get commit history
    // ponytail: expired GITHUB_PAT turns public-repo calls into 401s; the
    // question-generator has an unauthenticated fallback, this path still
    // requires a valid PAT. Update the GITHUB_PAT secret if commits fail.
    const commitsResponse = await fetch(
      `https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=100`,
      {
        headers: {
          'Authorization': `token ${githubPat}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'ProofLabAI-Verification'
        }
      }
    );

    if (!commitsResponse.ok) {
      console.error('GitHub API error:', commitsResponse.status);
      return null;
    }

    const commits = await commitsResponse.json();
    const commitCount = commits.length;
    const lastCommitDate = commits[0]?.commit?.committer?.date || new Date().toISOString();

    // Get unique contributors
    const contributors = new Set(commits.map((c: any) => c.commit?.author?.email).filter(Boolean));
    const uniqueContributors = contributors.size;

    // Calculate authenticity score
    const authenticityScore = Math.min(100, (commitCount * 10) + (uniqueContributors * 15));

    console.log(`GitHub verification completed: ${commitCount} commits, ${uniqueContributors} contributors`);

    return {
      commit_count: commitCount,
      last_commit_date: lastCommitDate,
      unique_contributors: uniqueContributors,
      authenticity_score: authenticityScore
    };
  } catch (error) {
    console.error('Error verifying GitHub repo:', error);
    return null;
  }
}

async function analyzeWithGemini(codeContent: string, repoSummary: string): Promise<{ originality_score: number; ai_summary: string; ai_comments: string }> {
  try {
    console.log('Analyzing code with Gemini AI...');

    const prompt = `Analyze this code submission and determine if it was likely AI-generated or human-developed.

Repository Summary: ${repoSummary}

Code Sample:
${codeContent.substring(0, 3000)}

Provide:
1. Originality Score (0-100): How original and human-crafted the code appears
2. Analysis: Brief reasoning for your assessment
3. Comments: Any red flags or positive indicators

Format your response as JSON:
{
  "originality_score": <number>,
  "analysis": "<text>",
  "comments": "<text>"
}`;

    let aiResponse: string;
    try {
      const result = await generateText(prompt, { maxOutputTokens: 2000 }, { feature: 'verify-proof' });
      aiResponse = result.text || '{}';
      console.log(`Proof verification via ${result.provider}`);
    } catch (llmError) {
      console.error('All LLM providers failed:', llmError);
      return {
        originality_score: 50,
        ai_summary: 'AI analysis unavailable',
        ai_comments: 'Could not complete AI verification'
      };
    }

    // Try to parse JSON from response
    let parsedResponse;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsedResponse = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
    } catch {
      parsedResponse = {
        originality_score: 50,
        analysis: aiResponse.substring(0, 500),
        comments: 'Analysis completed'
      };
    }

    return {
      originality_score: parsedResponse.originality_score || 50,
      ai_summary: parsedResponse.analysis || aiResponse.substring(0, 500),
      ai_comments: parsedResponse.comments || 'See summary for details'
    };
  } catch (error) {
    console.error('Error analyzing with Gemini:', error);
    return {
      originality_score: 50,
      ai_summary: 'AI analysis encountered an error',
      ai_comments: String(error)
    };
  }
}

async function downloadFileContent(fileUrl: string): Promise<string> {
  try {
    // SSRF guard: only https, only public hostnames, block private/loopback/link-local ranges
    let u: URL;
    try { u = new URL(fileUrl); } catch { return ''; }
    if (u.protocol !== 'https:') {
      console.warn('downloadFileContent rejected non-https URL');
      return '';
    }
    const host = u.hostname.toLowerCase();
    // Block obvious internal hostnames
    const blockedHosts = new Set([
      'localhost', 'ip6-localhost', 'ip6-loopback',
      'metadata.google.internal', 'metadata.goog',
    ]);
    if (blockedHosts.has(host) || host.endsWith('.internal') || host.endsWith('.local')) {
      console.warn('downloadFileContent rejected internal host:', host);
      return '';
    }
    // Block IP literals in private/loopback/link-local ranges
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
      const isPrivate =
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224; // multicast/reserved
      if (isPrivate) {
        console.warn('downloadFileContent rejected private IPv4:', host);
        return '';
      }
    }
    if (host.includes(':') || host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) {
      // Reject IPv6 literals conservatively
      console.warn('downloadFileContent rejected IPv6 literal');
      return '';
    }
    const response = await fetch(fileUrl, { redirect: 'error' });
    if (!response.ok) return '';
    return await response.text();
  } catch (error) {
    console.error('Error downloading file:', error);
    return '';
  }
}

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

    // Only GITHUB_PAT is required up front; the LLM provider is resolved inside
    // the shared helper, which falls back to a neutral score if none respond.
    if (!githubPat) {
      return new Response(
        JSON.stringify({ error: 'Required API keys not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { proofId } = await req.json();

    console.log('Starting verification for proof:', proofId);

    // 1. Fetch proof record with user_id
    const { data: proof, error: proofError } = await supabase
      .from('proof_uploads')
      .select(`
        *, 
        student_profiles!inner(full_name, college_id, user_id)
      `)
      .eq('id', proofId)
      .single();

    if (proofError || !proof) {
      console.error('Proof not found:', proofError);
      return new Response(
        JSON.stringify({ error: 'Proof not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // stage69: a coding task is graded automatically by submit-sandbox-task.
    // proof_uploads_reject_sandbox already stops a proof row from being
    // created against one, but this covers a proof that existed from before
    // a task was switched onto a sandbox config.
    const { data: proofTask } = await supabase
      .from('tasks')
      .select('sandbox_config_id')
      .eq('id', proof.task_id)
      .maybeSingle();
    if (proofTask?.sandbox_config_id) {
      return new Response(
        JSON.stringify({ error: 'This is a coding task. It is graded automatically, not verified.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Being signed in was checked above; being entitled to THIS proof was not.
    // Without it any account could re-verify a stranger's proof, overwrite
    // their trust_score, and file audit_logs rows under their user id.
    const proofOwner = (proof as any).student_profiles;
    const mayVerify = await mayActOnStudentWork(supabase, claims.claims.sub as string, {
      ownerUserId: proofOwner?.user_id ?? null,
      collegeId: proofOwner?.college_id ?? null,
    });
    if (!mayVerify) return forbidden(corsHeaders);

    const isGitHubLink = proof.file_url?.includes('github.com');
    let githubInfo: GitHubRepoInfo | null = null;
    const aiVerification: any = null;
    let fileContent = '';

    // 2. GitHub Verification
    if (isGitHubLink && proof.file_url) {
      githubInfo = await verifyGitHubRepo(proof.file_url, githubPat);
      
      if (githubInfo) {
        const { error: githubInsertError } = await supabase
          .from('github_verifications')
          .insert({
            proof_id: proofId,
            repo_url: proof.file_url,
            commit_count: githubInfo.commit_count,
            last_commit_at: githubInfo.last_commit_date,
            unique_contributors: githubInfo.unique_contributors,
            authenticity_score: githubInfo.authenticity_score
          });

        if (githubInsertError) {
          console.error('Error inserting GitHub verification:', githubInsertError);
        }
      }
    } else if (proof.file_url) {
      // Download file for analysis
      fileContent = await downloadFileContent(proof.file_url);
    }

    // 3. Gemini AI Verification
    const repoSummary = githubInfo 
      ? `GitHub repo with ${githubInfo.commit_count} commits from ${githubInfo.unique_contributors} contributors. Last commit: ${githubInfo.last_commit_date}`
      : 'Direct file upload';

    const codeToAnalyze = fileContent || proof.submission_notes || 'No code content available';
    const aiResult = await analyzeWithGemini(codeToAnalyze, repoSummary);

    const { error: aiInsertError } = await supabase
      .from('ai_verifications')
      .insert({
        proof_id: proofId,
        ai_summary: aiResult.ai_summary,
        originality_score: aiResult.originality_score,
        ai_comments: aiResult.ai_comments
      });

    if (aiInsertError) {
      console.error('Error inserting AI verification:', aiInsertError);
    }

    // 4. Calculate Trust Adjustment
    const mossScore = proof.moss_score || 0;
    const originalityScore = aiResult.originality_score;
    const authenticityScore = githubInfo?.authenticity_score || 50;

    let trustChange = 0;
    let reviewComment = '';

    if (mossScore < 20 && originalityScore > 70 && authenticityScore > 60) {
      trustChange = 10;
      reviewComment = 'Strong originality and commit history detected. High authenticity.';
    } else if (mossScore > 60) {
      trustChange = -15;
      reviewComment = 'High plagiarism detected via MOSS. Authenticity questionable.';
    } else {
      trustChange = 5;
      reviewComment = 'Moderate verification scores. Standard trust adjustment applied.';
    }

    // stage68: only a clean result auto-verifies. Anything else waits for a
    // human, flagged — the owner is allowed to call this function
    // (mayActOnStudentWork returns true for the proof owner), so "always
    // Verified" meant any student could verify their own proof and collect
    // the 25 squad points, the weekly-proof quest XP, and their task's XP in
    // one call. aiRan distinguishes "the AI actually looked at this" from the
    // fallback score of 50 analyzeWithGemini returns when every provider fails.
    const aiRan = aiResult.ai_summary !== 'AI analysis unavailable'
      && aiResult.ai_summary !== 'AI analysis encountered an error';
    const autoVerify = aiRan && trustChange > 0 && originalityScore >= 50;

    // 5. Update student trust score with error handling
    const { data: currentTrust, error: trustFetchError } = await supabase
      .from('student_profiles')
      .select('trust_score')
      .eq('id', proof.student_id)
      .maybeSingle();

    if (trustFetchError) {
      console.error('Error fetching trust score:', trustFetchError);
    }

    if (currentTrust) {
      const newTrustScore = Math.max(0, Math.min(100, (currentTrust.trust_score || 0) + trustChange));
      
      const { error: trustUpdateError } = await supabase
        .from('student_profiles')
        .update({ trust_score: newTrustScore })
        .eq('id', proof.student_id);

      if (trustUpdateError) {
        console.error('Error updating trust score:', trustUpdateError);
      }

      // Check if trust_scores entry exists before upserting
      const { data: existingTrustScore } = await supabase
        .from('trust_scores')
        .select('id')
        .eq('student_id', proof.student_id)
        .maybeSingle();

      if (existingTrustScore) {
        const { error: trustScoreUpdateError } = await supabase
          .from('trust_scores')
          .update({
            score: newTrustScore,
            last_updated: new Date().toISOString()
          })
          .eq('student_id', proof.student_id);

        if (trustScoreUpdateError) {
          console.error('Error updating trust_scores:', trustScoreUpdateError);
        }
      } else {
        const { error: trustScoreInsertError } = await supabase
          .from('trust_scores')
          .insert({
            student_id: proof.student_id,
            score: newTrustScore,
            last_updated: new Date().toISOString()
          });

        if (trustScoreInsertError) {
          console.error('Error inserting trust_scores:', trustScoreInsertError);
        }
      }
    }

    // 6. Update proof status with validated payload including AI data
    const updatePayload: any = {
      status: autoVerify ? 'Verified' : 'Under Review',
      admin_review_status: autoVerify ? 'Verified' : 'needs_review',
      review_flag: !autoVerify,
      review_comment: reviewComment,
      reviewed_at: autoVerify ? new Date().toISOString() : null,
      moss_status: mossScore > 0 ? 'completed' : null,
      moss_url: githubInfo ? proof.file_url : null,
      ai_score: originalityScore,
      ai_summary: aiResult.ai_summary,
      ai_feedback: aiResult.ai_comments,
      ai_status: 'completed'
    };

    console.log('Updating proof_uploads with payload:', JSON.stringify(updatePayload, null, 2));

    const { error: proofUpdateError } = await supabase
      .from('proof_uploads')
      .update(updatePayload)
      .eq('id', proofId);

    if (proofUpdateError) {
      console.error('Error updating proof_uploads:', proofUpdateError);
      // Log error to audit trail with proper user_id
      const studentUserId = proof.student_profiles?.user_id;
      if (studentUserId) {
        await supabase.from('audit_logs').insert({
          user_id: studentUserId,
          action: 'VERIFICATION_ERROR',
          table_name: 'proof_uploads',
          record_id: proofId,
          new_values: {
            error_message: proofUpdateError.message,
            attempted_payload: updatePayload
          }
        }).then(({ error }) => {
          if (error) console.error('Failed to log error to audit:', error);
        });
      }
    }

    // 7. Log audit trail - check for existing entry first
    const auditAction = autoVerify ? 'AUTO_VERIFIED' : 'FLAGGED_FOR_REVIEW';
    const { data: existingAudit } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('record_id', proofId)
      .eq('action', auditAction)
      .maybeSingle();

    if (!existingAudit) {
      const studentUserId = proof.student_profiles?.user_id;
      if (studentUserId) {
        const { error: auditError } = await supabase.from('audit_logs').insert({
          user_id: studentUserId,
          action: auditAction,
          table_name: 'proof_uploads',
          record_id: proofId,
          new_values: {
            moss_score: mossScore,
            originality_score: originalityScore,
            authenticity_score: authenticityScore,
            trust_change: trustChange
          }
        });

        if (auditError) {
          console.error('Error inserting audit log:', auditError);
        }
      }
    }

    const result: VerificationResult = {
      proofId,
      moss_score: mossScore,
      originality_score: originalityScore,
      authenticity_score: authenticityScore,
      trust_change: trustChange,
      review_comment: reviewComment,
      auto_verified: autoVerify
    };

    console.log('Verification completed:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in verify-proof function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
