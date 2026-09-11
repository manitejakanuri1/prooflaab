import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { cors } from "../_shared/cors.ts";
import { mayActOnStudentWork, forbidden } from "../_shared/authz.ts";

interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  stats?: {
    total: number;
    additions: number;
    deletions: number;
  };
  files?: Array<{
    filename: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

interface CommitAnalysis {
  commit_count: number;
  first_commit_at: string;
  last_commit_at: string;
  largest_commit_delta: number;
  authors: string[];
  suspicious_flags: string[];
  authenticity_notes: any;
}

serve(async (req) => {
  const corsHeaders = cors(req);
  // Handle CORS preflight
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

    if (!githubPat) {
      throw new Error('GITHUB_PAT secret not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { proof_id, repo_url } = await req.json();

    if (!proof_id || !repo_url) {
      return new Response(
        JSON.stringify({ error: 'proof_id and repo_url are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ownership / role authorization + repo_url must match stored proof.file_url
    const callerId = claims.claims.sub;
    const { data: proofRow, error: proofErr } = await supabase
      .from('proof_uploads')
      .select('id, file_url, student_profiles!inner(user_id, college_id)')
      .eq('id', proof_id)
      .maybeSingle();
    if (proofErr || !proofRow) {
      return new Response(
        JSON.stringify({ error: 'Proof not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const ownerProfile = (proofRow as any).student_profiles;
    const allowed = await mayActOnStudentWork(supabase, callerId, {
      ownerUserId: ownerProfile?.user_id ?? null,
      collegeId: ownerProfile?.college_id ?? null,
    });
    if (!allowed) return forbidden(corsHeaders);
    if (!proofRow.file_url || proofRow.file_url !== repo_url) {
      return new Response(
        JSON.stringify({ error: 'repo_url does not match the proof record' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting GitHub check for proof:', proof_id);
    console.log('Repository URL:', repo_url);

    // Parse GitHub URL to extract owner and repo
    const repoMatch = repo_url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      throw new Error('Invalid GitHub repository URL');
    }

    const [, owner, repoName] = repoMatch;
    const cleanRepoName = repoName.replace(/\.git$/, '');

    console.log(`Fetching commits for ${owner}/${cleanRepoName}`);

    // Fetch commits from GitHub API
    const commitsResponse = await fetch(
      `https://api.github.com/repos/${owner}/${cleanRepoName}/commits`,
      {
        headers: {
          'Authorization': `Bearer ${githubPat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!commitsResponse.ok) {
      const errorText = await commitsResponse.text();
      console.error('GitHub API error:', errorText);
      throw new Error(`GitHub API error: ${commitsResponse.status} - ${errorText}`);
    }

    const commits: GitHubCommit[] = await commitsResponse.json();

    if (commits.length === 0) {
      throw new Error('No commits found in repository');
    }

    console.log(`Found ${commits.length} commits`);

    // Fetch detailed commit info for each commit to get stats
    const detailedCommits: GitHubCommit[] = [];
    let largestDelta = 0;

    for (const commit of commits.slice(0, 100)) { // Limit to 100 commits to avoid rate limits
      try {
        const detailResponse = await fetch(
          `https://api.github.com/repos/${owner}/${cleanRepoName}/commits/${commit.sha}`,
          {
            headers: {
              'Authorization': `Bearer ${githubPat}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          }
        );

        if (detailResponse.ok) {
          const detailedCommit: GitHubCommit = await detailResponse.json();
          detailedCommits.push(detailedCommit);

          // Calculate largest delta (files changed)
          const filesChanged = detailedCommit.files?.length || 0;
          const linesChanged = detailedCommit.stats?.total || 0;
          const delta = Math.max(filesChanged, linesChanged);

          if (delta > largestDelta) {
            largestDelta = delta;
          }
        }
      } catch (error) {
        console.error(`Error fetching commit ${commit.sha}:`, error);
      }
    }

    // Extract unique authors
    const authors = Array.from(
      new Set(detailedCommits.map(c => c.commit.author.email))
    );

    // Analyze commits
    const firstCommit = detailedCommits[detailedCommits.length - 1];
    const lastCommit = detailedCommits[0];

    const analysis: CommitAnalysis = {
      commit_count: commits.length,
      first_commit_at: firstCommit.commit.author.date,
      last_commit_at: lastCommit.commit.author.date,
      largest_commit_delta: largestDelta,
      authors: authors,
      suspicious_flags: [],
      authenticity_notes: {
        total_commits: commits.length,
        unique_authors: authors.length,
        author_emails: authors,
        commit_timeline: {
          first: firstCommit.commit.author.date,
          last: lastCommit.commit.author.date,
        },
        largest_commit: {
          sha: detailedCommits.find(c => {
            const filesChanged = c.files?.length || 0;
            const linesChanged = c.stats?.total || 0;
            return Math.max(filesChanged, linesChanged) === largestDelta;
          })?.sha || 'unknown',
          delta: largestDelta,
        },
      },
    };

    // Check for suspicious patterns
    if (commits.length === 1) {
      analysis.suspicious_flags.push('SINGLE_COMMIT');
    }

    if (authors.length === 1 && commits.length > 10) {
      analysis.suspicious_flags.push('SINGLE_AUTHOR_MANY_COMMITS');
    }

    if (largestDelta > 50) {
      analysis.suspicious_flags.push('LARGE_SINGLE_COMMIT');
    }

    // Check if all commits happened in a very short time span
    const firstDate = new Date(analysis.first_commit_at);
    const lastDate = new Date(analysis.last_commit_at);
    const timeDiffHours = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60);

    if (timeDiffHours < 1 && commits.length > 5) {
      analysis.suspicious_flags.push('RAPID_COMMITS');
    }

    console.log('Analysis complete:', analysis);

    // Save to github_verifications table
    const { data: verification, error: dbError } = await supabase
      .from('github_verifications')
      .insert({
        proof_id,
        repo_url,
        commit_count: analysis.commit_count,
        first_commit_at: analysis.first_commit_at,
        last_commit_at: analysis.last_commit_at,
        largest_commit_delta: analysis.largest_commit_delta,
        authenticity_notes: analysis.authenticity_notes,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to save verification: ${dbError.message}`);
    }

    console.log('Verification saved:', verification.id);

    // Return summary
    return new Response(
      JSON.stringify({
        success: true,
        verification_id: verification.id,
        commit_count: analysis.commit_count,
        first_commit_at: analysis.first_commit_at,
        last_commit_at: analysis.last_commit_at,
        largest_commit_delta: analysis.largest_commit_delta,
        suspicious_flags: analysis.suspicious_flags,
        authors_count: authors.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('GitHub check error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
