import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";
import { mayActOnStudentWork, forbidden } from "../_shared/authz.ts";

interface TrustScoreResult {
  proof_id: string;
  student_id: string;
  commit_authenticity_score: number;
  ai_authorship_score: number;
  conceptual_understanding_score: number;
  cognitive_integrity_score: number;
  suggested_action: 'verified' | 'needs_review' | 'failed';
  summary: string;
}

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Check for webhook secret (for internal/scheduled calls)
    const webhookSecret = req.headers.get('x-webhook-secret');
    const expectedSecret = Deno.env.get('WEBHOOK_SECRET');
    
    // Check for JWT auth (for authenticated user calls)
    const authHeader = req.headers.get('Authorization');
    
    let isAuthorized = false;
    // Stays null on the webhook path: the scheduled caller is not a user and
    // has no proof of its own to be scoped against.
    let callerId: string | null = null;
    
    // Option 1: Webhook secret for internal/cron calls
    if (webhookSecret && expectedSecret && webhookSecret === expectedSecret) {
      isAuthorized = true;
    }
    // Option 2: JWT authentication for user calls
    else if (authHeader?.startsWith('Bearer ')) {
      const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      
      const token = authHeader.replace('Bearer ', '');
      const { data, error } = await supabaseClient.auth.getUser(token);
      
      if (!error && data?.user) {
        isAuthorized = true;
        callerId = data.user.id;
      }
    }
    
    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { proof_id } = await req.json();

    if (!proof_id) {
      return new Response(
        JSON.stringify({ error: 'Missing proof_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // A signed-in caller may only touch a proof they own, or one belonging to a
    // student in a college they administer. Being signed in was already checked;
    // being entitled to THIS proof was not. The webhook caller skips this.
    if (callerId) {
      const { data: ownerRow } = await supabase
        .from('proof_uploads')
        .select('student_profiles(user_id, college_id)')
        .eq('id', proof_id)
        .maybeSingle();

      const owner = (ownerRow as { student_profiles?: { user_id: string | null; college_id: string | null } } | null)
        ?.student_profiles;
      const mayAct = await mayActOnStudentWork(supabase, callerId, {
        ownerUserId: owner?.user_id ?? null,
        collegeId: owner?.college_id ?? null,
      });
      if (!mayAct) return forbidden(corsHeaders);
    }

    console.log(`Computing trust score for proof ${proof_id}`);

    // Fetch proof upload to get student_id and integrity declarations
    const { data: proofUpload, error: proofError } = await supabase
      .from('proof_uploads')
      .select('student_id, declaration_acknowledged, reflection_requested')
      .eq('id', proof_id)
      .single();

    if (proofError || !proofUpload) {
      return new Response(
        JSON.stringify({ error: 'Proof upload not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const student_id = proofUpload.student_id;

    // Fetch GitHub verification
    const { data: githubVerification } = await supabase
      .from('github_verifications')
      .select('*')
      .eq('proof_id', proof_id)
      .single();

    // Fetch AI verification
    const { data: aiVerification } = await supabase
      .from('ai_verifications')
      .select('*')
      .eq('proof_id', proof_id)
      .single();

    // Fetch conceptual test
    const { data: conceptualTest } = await supabase
      .from('conceptual_tests')
      .select('*')
      .eq('proof_id', proof_id)
      .single();

    // Calculate commit_authenticity_score
    let commitAuthenticityScore = 0;
    if (githubVerification) {
      const commitCount = githubVerification.commit_count || 0;
      const largestCommitDelta = githubVerification.largest_commit_delta || 0;
      const authenticityScore = githubVerification.authenticity_score || 0;

      // Normalize commit count (more commits = better, cap at 20 commits = 100)
      const commitCountScore = Math.min((commitCount / 20) * 100, 100);

      // Penalize large single commits (delta > 1000 lines is suspicious)
      const singleBigCommitPenalty = largestCommitDelta > 1000 ? 20 : 0;

      // Weighted average
      commitAuthenticityScore = Math.max(0, 
        (commitCountScore * 0.4) + 
        (authenticityScore * 0.6) - 
        singleBigCommitPenalty
      );
    }

    // Calculate ai_authorship_score (100 - risk)
    let aiAuthorshipScore = 100;
    if (aiVerification && aiVerification.ai_authorship_risk !== null) {
      aiAuthorshipScore = Math.max(0, 100 - (aiVerification.ai_authorship_risk || 0));
    }

    // Get conceptual_understanding_score
    let conceptualUnderstandingScore = 0;
    if (conceptualTest && conceptualTest.answer_scores) {
      const answerScores = conceptualTest.answer_scores as { final_score?: number }[];
      if (answerScores.length > 0) {
        conceptualUnderstandingScore = Math.round(
          answerScores.reduce((sum, score) => sum + (score.final_score || 0), 0) / answerScores.length
        );
      }
    }

    // Calculate base cognitive_integrity_score
    // Updated CIS formula (v2.0) for fairer weighting and adaptive thresholds
    // Weights: 35% commit, 25% ai_authorship, 40% conceptual
    const baseCIS = Math.round(
      (commitAuthenticityScore * 0.35) +
      (aiAuthorshipScore * 0.25) +
      (conceptualUnderstandingScore * 0.40)
    );

    // The 60-second spoken explanation.
    //
    // Added as an adjustment rather than a fourth weight, because 35/25/40 is a
    // deliberate split and quietly reshuffling it would change every score
    // already awarded. Capped at +10, so it can lift a borderline submission
    // into review or over the line without ever carrying one on its own.
    //
    // The sign matters: a strong explanation helps, and a missing one simply
    // does not help. It is never a penalty — a student with a broken
    // microphone has not cheated.
    //
    // Step 6H: restricted to transcript_source = 'server' - a real staging
    // test found a student could POST a fabricated transcript directly
    // (migration 43 correctly labels this 'browser', it does not block it -
    // that insert is also the legitimate synchronous recording path) and
    // get it graded by voice-score with no audio ever recorded. 'browser'
    // transcripts are exactly as easy to paste as anything else on this
    // form, so they cannot carry the trust adjustment the comment above
    // used to claim only this signal earns. Only 'server' - written back by
    // complete_transcription_job after the async worker actually ran
    // Whisper on audio the student actually uploaded - has that property.
    // A 'browser' explanation is still shown to the student and still
    // scored (the synchronous path and its UX are unchanged); it just does
    // not move trust until it has gone through the queue.
    //
    // Step 6I: the provenance check must be a query filter, not a check
    // against whichever row "order by created_at desc limit 1" happened to
    // return first. The first version picked the single newest scored row
    // regardless of source and only THEN asked whether it was eligible - so
    // a newer 'browser' explanation for the same proof made an older,
    // perfectly eligible 'server' one invisible, instead of just not
    // counting itself. Filtering transcript_source in the query means the
    // newest ELIGIBLE row is what gets found, whether or not a newer
    // ineligible one also exists.
    const { data: voice } = await supabase
      .from('voice_explanations')
      .select('communication_score')
      .eq('proof_id', proof_id)
      .eq('status', 'scored')
      .eq('transcript_source', 'server')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const voiceScore: number | null = voice?.communication_score ?? null;
    const voiceAdjustment = voiceScore === null
      ? 0
      : Math.round((voiceScore / 100) * 10);

    // Apply ethical framing adjustments
    let ethicalAdjustment = voiceAdjustment;
    if (proofUpload.declaration_acknowledged === true) {
      ethicalAdjustment += 5; // Reward honesty and transparency
    }
    if (proofUpload.reflection_requested === true) {
      ethicalAdjustment += 3; // Reward learning mindset
    }

    const cognitiveIntegrityScore = Math.min(100, baseCIS + ethicalAdjustment);

    // Determine suggested action with updated thresholds
    let suggestedAction: 'verified' | 'needs_review' | 'failed';
    let summary: string;
    let trustDelta = 0;

    if (cognitiveIntegrityScore >= 60) {
      suggestedAction = 'verified';
      trustDelta = 3;
      summary = `High cognitive integrity (${cognitiveIntegrityScore}/100). All verifications passed with strong scores. Recommended for automatic approval.`;
    } else if (cognitiveIntegrityScore >= 40) {
      suggestedAction = 'needs_review';
      trustDelta = 1;
      summary = `Moderate cognitive integrity (${cognitiveIntegrityScore}/100). Some concerns detected. Manual review recommended before approval.`;
    } else {
      suggestedAction = 'failed';
      trustDelta = 0;
      summary = `Low cognitive integrity (${cognitiveIntegrityScore}/100). Multiple red flags detected. Not recommended for approval. Admin notified for manual review.`;
    }

    // Add specific concerns to summary
    const concerns: string[] = [];
    if (commitAuthenticityScore < 50) concerns.push('Low commit authenticity');
    if (aiAuthorshipScore < 50) concerns.push('High AI-generated content likelihood');
    if (conceptualUnderstandingScore < 50) concerns.push('Weak conceptual understanding');

    if (concerns.length > 0) {
      summary += ` Concerns: ${concerns.join(', ')}.`;
    }

    console.log(`Trust score computed: ${cognitiveIntegrityScore}/100 (base: ${baseCIS}, adjustment: +${ethicalAdjustment}, voice: ${voiceScore ?? 'none'}) (${suggestedAction}), trust delta: +${trustDelta}`);

    // Update trust_scores (one row per student — unique_student_trust_score)
    const { error: trustScoreError } = await supabase
      .from('trust_scores')
      .upsert({
        student_id: student_id,
        proof_id: proof_id,
        score: cognitiveIntegrityScore,
        commit_authenticity_score: commitAuthenticityScore,
        ai_authorship_score: aiAuthorshipScore,
        conceptual_understanding_score: conceptualUnderstandingScore,
        cognitive_integrity_score: cognitiveIntegrityScore,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'student_id'
      });

    if (trustScoreError) {
      console.error('Error updating trust_scores:', trustScoreError);
    }

    // Update proof_uploads with status and summary
    const newStatus = suggestedAction === 'verified' ? 'Verified' : 
                      suggestedAction === 'needs_review' ? 'needs_review' : 'Rejected';
    
    const { error: proofUpdateError } = await supabase
      .from('proof_uploads')
      .update({
        status: newStatus,
        admin_review_status: suggestedAction === 'verified' ? 'Approved' : 
                           suggestedAction === 'needs_review' ? 'Pending' : 'Rejected',
        ai_summary: summary,
        ai_score: cognitiveIntegrityScore,
        review_comment: summary,
        review_flag: suggestedAction === 'needs_review' || suggestedAction === 'failed' // Flag for manual review
      })
      .eq('id', proof_id);

    if (proofUpdateError) {
      console.error('Error updating proof_uploads:', proofUpdateError);
    }

    // Update student profile trust score
    const { error: profileUpdateError } = await supabase
      .from('student_profiles')
      .update({
        trust_score: cognitiveIntegrityScore
      })
      .eq('id', student_id);

    if (profileUpdateError) {
      console.error('Error updating student profile:', profileUpdateError);
    }

    // Log to audit_logs with ethical adjustments
    await supabase
      .from('audit_logs')
      .insert({
        user_id: student_id,
        action: 'trust_score_computed',
        table_name: 'trust_scores',
        record_id: proof_id,
        new_values: {
          proof_id,
          student_id,
          base_cis: baseCIS,
          ethical_adjustment: ethicalAdjustment,
          adjusted_cis: cognitiveIntegrityScore,
          cognitive_integrity_score: cognitiveIntegrityScore,
          suggested_action: suggestedAction,
          declaration_acknowledged: proofUpload.declaration_acknowledged,
          reflection_requested: proofUpload.reflection_requested
        }
      });

    const result: TrustScoreResult = {
      proof_id,
      student_id,
      commit_authenticity_score: Math.round(commitAuthenticityScore),
      ai_authorship_score: Math.round(aiAuthorshipScore),
      conceptual_understanding_score: conceptualUnderstandingScore,
      cognitive_integrity_score: cognitiveIntegrityScore,
      suggested_action: suggestedAction,
      summary: summary
    };

    console.log(`Trust computation complete for proof ${proof_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in trust-compute:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
