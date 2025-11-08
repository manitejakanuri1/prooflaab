import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

async function analyzeWithGemini(codeContent: string, repoSummary: string, geminiKey: string): Promise<{ originality_score: number; ai_summary: string; ai_comments: string }> {
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      }
    );

    if (!response.ok) {
      console.error('Gemini API error:', response.status);
      return {
        originality_score: 50,
        ai_summary: 'AI analysis unavailable',
        ai_comments: 'Could not complete AI verification'
      };
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    console.log('Gemini raw response:', aiResponse);

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
    const response = await fetch(fileUrl);
    if (!response.ok) return '';
    return await response.text();
  } catch (error) {
    console.error('Error downloading file:', error);
    return '';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const githubPat = Deno.env.get('GITHUB_PAT');
    const geminiKey = Deno.env.get('GEMINI_API_KEY');

    if (!githubPat || !geminiKey) {
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
        student_profiles!inner(full_name, email, college_id, user_id)
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

    const isGitHubLink = proof.file_url?.includes('github.com');
    let githubInfo: GitHubRepoInfo | null = null;
    let aiVerification: any = null;
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
    const aiResult = await analyzeWithGemini(codeToAnalyze, repoSummary, geminiKey);

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
      status: 'Verified',
      admin_review_status: 'Verified',
      review_comment: reviewComment,
      reviewed_at: new Date().toISOString(),
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
    const { data: existingAudit } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('record_id', proofId)
      .eq('action', 'AUTO_VERIFIED')
      .maybeSingle();

    if (!existingAudit) {
      const studentUserId = proof.student_profiles?.user_id;
      if (studentUserId) {
        const { error: auditError } = await supabase.from('audit_logs').insert({
          user_id: studentUserId,
          action: 'AUTO_VERIFIED',
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
      review_comment: reviewComment
    };

    console.log('Verification completed:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in verify-proof function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
