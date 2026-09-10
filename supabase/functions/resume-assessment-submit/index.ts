import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";
import { classifySkillGap } from "../_shared/role-skills.ts";
import { normSkill, placeStudent } from "../_shared/levels.ts";
import { corsHeaders } from "../_shared/cors.ts";

/** Must match the countdown in TimedResumeAssessment. */
const SECONDS_PER_QUESTION = 15;
/**
 * Slack on top of the per-question budget, covering page load, a reload that
 * resumes from local storage, and a slow connection. Generous on purpose: the
 * cost of refusing an honest attempt is far higher than the cost of allowing a
 * slightly slow one.
 */
const TIME_GRACE_SECONDS = 600;

type ConfidenceLevel = 'high' | 'medium' | 'low';

interface AnswerInput {
  question_id: string;
  answer_text: string;
  selected_index?: number;
  confidence?: ConfidenceLevel;
}

interface AnswerScore {
  question_id: string;
  correctness_score: number;
  explanation: string;
  final_score: number;
  question_prompt: string;
  question_type: 'mcq' | 'short_answer';
  student_answer: string;
  correct_answer?: string;
  confidence?: ConfidenceLevel;
  confidence_flag?: 'lucky_guess' | 'overconfident' | null;
  category: 'skill' | 'project_defense';
  reasoning_clarity_score?: number;
}

function deriveConfidenceFlag(finalScore: number, confidence?: ConfidenceLevel): 'lucky_guess' | 'overconfident' | null {
  if (!confidence) return null;
  if (finalScore >= 70 && confidence === 'low') return 'lucky_guess';
  if (finalScore < 50 && confidence === 'high') return 'overconfident';
  return null;
}

serve(async (req) => {
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

    const { assessment_id, answers } = await req.json();
    if (!assessment_id || !Array.isArray(answers) || answers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'assessment_id and a non-empty answers array are required' }),
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

    const { data: assessment, error: assessmentError } = await supabase
      .from('resume_assessments')
      .select('id, student_id, resume_claims_id, student_interest_id, questions, status, is_retest, started_at')
      .eq('id', assessment_id)
      .maybeSingle();

    if (assessmentError || !assessment) {
      return new Response(
        JSON.stringify({ error: 'Assessment not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (assessment.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (assessment.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: `Cannot submit. Current status: ${assessment.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const questions = (assessment.questions ?? []) as any[];

    // Timing is checked here because the client cannot be asked to police
    // itself: the countdown lives in the browser, and the browser is the thing
    // being tested. Without this the endpoint accepted answers any time, so the
    // 15-second limit could be ignored by anyone willing to open the console.
    //
    // The allowance is deliberately loose. The modal can be reloaded and resumed
    // from local storage, pages take time to load, and a student who genuinely
    // took the test should never be refused. What this stops is the hour-long
    // attempt, not the slow one.
    const elapsedSeconds = assessment.started_at
      ? Math.round((Date.now() - new Date(assessment.started_at).getTime()) / 1000)
      : null;
    const allowanceSeconds = questions.length * SECONDS_PER_QUESTION + TIME_GRACE_SECONDS;

    if (elapsedSeconds !== null && elapsedSeconds > allowanceSeconds) {
      await supabase
        .from('resume_assessments')
        .update({ status: 'expired', elapsed_seconds: elapsedSeconds })
        .eq('id', assessment_id);

      return new Response(
        JSON.stringify({
          error: 'This attempt ran well over the time limit, so it cannot be scored. You can start a fresh attempt.',
          time_exceeded: true,
          elapsed_seconds: elapsedSeconds,
          allowed_seconds: allowanceSeconds,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const questionsById = new Map(questions.map((q: any) => [q.id, q]));
    const timestampedAnswers = (answers as AnswerInput[]).map((a) => ({
      question_id: a.question_id,
      answer_text: a.answer_text ?? '',
      ...(typeof a.selected_index === 'number' ? { selected_index: a.selected_index } : {}),
      ...(a.confidence ? { confidence: a.confidence } : {}),
      answered_at: new Date().toISOString(),
    }));

    const answerScores: AnswerScore[] = [];

    for (const answer of timestampedAnswers) {
      const question = questionsById.get(answer.question_id);
      if (!question) continue;

      const category: 'skill' | 'project_defense' = question.category === 'project_defense' ? 'project_defense' : 'skill';

      if (question.type === 'mcq') {
        const correct = typeof answer.selected_index === 'number' && answer.selected_index === question.correct_index;
        const finalScore = correct ? 100 : 0;
        answerScores.push({
          question_id: answer.question_id,
          correctness_score: finalScore,
          explanation: question.explanation || (correct ? 'Correct answer selected' : 'Wrong or no option selected'),
          final_score: finalScore,
          question_prompt: question.prompt,
          question_type: 'mcq',
          student_answer: answer.answer_text || '(no answer given)',
          correct_answer: question.options?.[question.correct_index],
          confidence: (answer as any).confidence,
          confidence_flag: deriveConfidenceFlag(finalScore, (answer as any).confidence),
          category,
        });
        continue;
      }

      // short_answer — grade with Gemini
      const evalPrompt = `You are checking whether a student's typed explanation shows real understanding, for a resume-verification test.

Question: ${question.prompt}
Student's answer: ${answer.answer_text || '(no answer given)'}

Return a JSON object:
{
  "correctness_score": <0-100, does this show real understanding of what they claimed>,
  "reasoning_clarity_score": <0-100, separate from correctness — how clearly and logically they explained their thinking, regardless of whether the content itself was fully right>,
  "explanation": "<1-2 sentences, written with real personality — quirky and funny, like a witty friend roasting or hyping them, never a dry textbook verdict. If the score is below 70, it MUST name the specific thing missing or wrong in their answer (not just 'be more specific') so they know exactly what to fix. If 70+, name the specific thing they got right.>"
}

Guidelines: a vague, generic, or copy-pasted-sounding answer with no specifics scores low even if technically not wrong. A specific, concrete explanation referencing real details scores high.

Return ONLY the JSON object.`;

      let score = 0;
      let reasoningClarityScore = 0;
      let explanation = 'Could not be graded — the grading gremlins are on strike.';
      try {
        // Cached: identical answer to an identical question must get an identical
        // grade. That is a fairness requirement before it is a saving — two
        // students who write the same sentence should not be marked differently.
        const result = await generateText(evalPrompt, { temperature: 0.3, maxOutputTokens: 500, cache: true }, { feature: 'resume-assessment-submit' });
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          score = Math.max(0, Math.min(100, Math.round(parsed.correctness_score) || 0));
          reasoningClarityScore = Math.max(0, Math.min(100, Math.round(parsed.reasoning_clarity_score) || 0));
          explanation = parsed.explanation || explanation;
        }
      } catch (e) {
        console.error('Short-answer grading failed:', e);
      }

      answerScores.push({
        question_id: answer.question_id,
        correctness_score: score,
        explanation,
        final_score: score,
        question_prompt: question.prompt,
        question_type: 'short_answer',
        student_answer: answer.answer_text || '(no answer given)',
        confidence: (answer as any).confidence,
        confidence_flag: deriveConfidenceFlag(score, (answer as any).confidence),
        category,
        reasoning_clarity_score: reasoningClarityScore,
      });
    }

    const skillAnswers = answerScores.filter((s) => s.category === 'skill');
    const projectAnswers = answerScores.filter((s) => s.category === 'project_defense');
    const reasoningAnswers = answerScores.filter((s) => s.question_type === 'short_answer');

    const skillProofScore = skillAnswers.length > 0
      ? Math.round(skillAnswers.reduce((sum, s) => sum + s.final_score, 0) / skillAnswers.length)
      : 0;
    const projectProofScore = projectAnswers.length > 0
      ? Math.round(projectAnswers.reduce((sum, s) => sum + s.final_score, 0) / projectAnswers.length)
      : null;
    const reasoningScore = reasoningAnswers.length > 0
      ? Math.round(reasoningAnswers.reduce((sum, s) => sum + (s.reasoning_clarity_score ?? 0), 0) / reasoningAnswers.length)
      : null;

    const { error: updateError } = await supabase
      .from('resume_assessments')
      .update({
        student_answers: timestampedAnswers,
        answer_scores: answerScores,
        status: 'graded',
        // Recorded even when within the allowance, so a pattern of attempts that
        // sit just under the line is visible rather than invisible.
        elapsed_seconds: elapsedSeconds,
      })
      .eq('id', assessment_id);

    if (updateError) {
      console.error('Error saving graded assessment:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save assessment results' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // A skip-path assessment has no resume behind it, so the two resume-only
    // scores stay null and there are no projects or certificates to weigh.
    // Everything downstream already treats those as optional.
    const { data: resumeClaim } = assessment.resume_claims_id
      ? await supabase
          .from('resume_claims')
          .select('resume_quality_score, ats_match_score, skills, target_role, projects, certifications')
          .eq('id', assessment.resume_claims_id)
          .maybeSingle()
      : await supabase
          .from('student_interests')
          .select('target_role, skills')
          .eq('id', assessment.student_interest_id)
          .maybeSingle()
          .then(({ data }) => ({
            data: data
              ? {
                  resume_quality_score: null,
                  ats_match_score: null,
                  skills: data.skills || [],
                  target_role: data.target_role,
                  projects: [],
                  certifications: [],
                }
              : null,
          }));

    // Build a short, targeted roadmap from whichever questions scored low
    const weakQuestions = questions.filter((q: any) =>
      answerScores.some((s) => s.question_id === q.id && s.final_score < 70)
    );

    const luckyGuesses = answerScores.filter((s) => s.confidence_flag === 'lucky_guess');
    const overconfident = answerScores.filter((s) => s.confidence_flag === 'overconfident');

    // Role-specific skill gap: verified/needs-improvement/missing against a static
    // required-skills list for the target role. Unknown/custom roles → null, and
    // the roadmap below just falls back to its old weak-question-only behavior.
    const skillGap = classifySkillGap(
      resumeClaim?.target_role,
      resumeClaim?.skills || [],
      weakQuestions.map((q: any) => q.prompt)
    );

    let roadmap = JSON.stringify([
      { title: 'Clean sweep', why: "Nothing weak to roast here — you actually knew your stuff.", action: "Come back for a re-check later to prove it wasn't a fluke." },
    ]);
    if (weakQuestions.length > 0 || luckyGuesses.length > 0 || overconfident.length > 0 || (skillGap && skillGap.missing.length > 0)) {
      const confidenceNotes = [
        luckyGuesses.length > 0
          ? `They marked themselves LOW confidence but nailed these anyway — fold in a "sneaky lucky guess" stage: ${luckyGuesses.map((s) => s.question_prompt).join(' | ')}`
          : '',
        overconfident.length > 0
          ? `They marked themselves HIGH confidence but bombed these — fold in a "confident bluff" stage: ${overconfident.map((s) => s.question_prompt).join(' | ')}`
          : '',
      ].filter(Boolean).join('\n');

      const skillGapNotes = skillGap
        ? `\nSkills required for "${resumeClaim?.target_role}" they haven't claimed at all — fold these in as their own foundational stage(s), even though no question tested them: ${skillGap.missing.join(', ') || '(none)'}\nClaimed skills that overlapped with weak answers above (already covered as weak-question stages, don't duplicate): ${skillGap.needs_improvement.join(', ') || '(none)'}`
        : '';

      const roadmapPrompt = `You are a witty, funny mentor giving a student direct, specific coaching after a skills-verification test. Think "roast with love" — a friend who's genuinely rooting for them but isn't afraid to be quirky, playful, and a little cheeky about it. NOT a boring corporate coach, and NOT a re-taught lesson — one punchy beat per stage, not paragraphs.

Student is targeting: "${resumeClaim?.target_role || 'a role'}"
Claimed skills: [${(resumeClaim?.skills || []).join(', ')}]

They got these specific questions wrong or weak:
${weakQuestions.map((q: any, i: number) => `${i + 1}. ${q.prompt}`).join('\n') || '(none — see confidence notes below)'}
${confidenceNotes ? `\nConfidence-vs-performance mismatches to fold in as their own stage:\n${confidenceNotes}` : ''}
${skillGapNotes}

Return a JSON array, ordered from the most foundational/urgent gap first to the most polish-level gap last (a "from scratch to sharp" progression), one object per distinct weak topic (plus one per confidence mismatch, plus one per missing required skill, if any). Each object:
{"title": "short punchy stage name (3-6 words, not the raw question)", "why": "ONE quirky sentence — a joke or fun analogy — on why it matters for the role, no lecture", "action": "ONE concrete next step: a specific thing to practice, build, or re-read (e.g. '5 problems on X on LeetCode', 'rebuild the auth flow in your project using Y properly'), phrased with flair, not 'study more'"}

Rules: 3-6 stages max — merge overlapping topics rather than listing everything. Never actually mean, never say "learn everything from scratch," never truly shame the student. Return ONLY the JSON array, no markdown fences, no commentary.`;

      try {
        // Tagged, unlike before: this was the whole of the 'unattributed' line in
        // the usage table, so the roadmap's spend was invisible next to every
        // other feature's. Not cached — it is written from one student's specific
        // wrong answers and should never be handed to somebody else.
        const result = await generateText(
          roadmapPrompt,
          { temperature: 0.6, maxOutputTokens: 1200 },
          { feature: 'resume-roadmap', userId: callerId, studentId: profile.id },
        );
        const jsonMatch = result.text.match(/\[[\s\S]*\]/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((s) => typeof s?.title === 'string' && typeof s?.why === 'string' && typeof s?.action === 'string')
        ) {
          roadmap = JSON.stringify(parsed);
        }
      } catch (e) {
        console.error('Roadmap generation failed:', e);
      }
    }

    // Interview Readiness Score: weighted composite per the product doc
    // (20% resume quality, 20% ATS match, 30% skill proof, 15% project proof,
    // 15% reasoning). Project proof / reasoning are null when nothing of that
    // type was asked (e.g. no claimed project) — those weights get dropped and
    // the rest renormalized rather than treating a null as a 0.
    const readinessComponents: { score: number; weight: number }[] = [
      ...(resumeClaim?.resume_quality_score != null ? [{ score: resumeClaim.resume_quality_score, weight: 20 }] : []),
      ...(resumeClaim?.ats_match_score != null ? [{ score: resumeClaim.ats_match_score, weight: 20 }] : []),
      { score: skillProofScore, weight: 30 },
      ...(projectProofScore != null ? [{ score: projectProofScore, weight: 15 }] : []),
      ...(reasoningScore != null ? [{ score: reasoningScore, weight: 15 }] : []),
    ];
    const readinessWeightSum = readinessComponents.reduce((sum, c) => sum + c.weight, 0);
    const interviewReadinessScore = readinessWeightSum > 0
      ? Math.round(readinessComponents.reduce((sum, c) => sum + c.score * c.weight, 0) / readinessWeightSum)
      : null;

    const { data: scorecard, error: scorecardError } = await supabase
      .from('resume_scorecards')
      .insert({
        student_id: profile.id,
        resume_claims_id: assessment.resume_claims_id,
        student_interest_id: assessment.student_interest_id,
        assessment_id: assessment.id,
        resume_quality_score: resumeClaim?.resume_quality_score ?? null,
        ats_match_score: resumeClaim?.ats_match_score ?? null,
        skill_proof_score: skillProofScore,
        project_proof_score: projectProofScore,
        reasoning_score: reasoningScore,
        interview_readiness_score: interviewReadinessScore,
        roadmap,
        skill_gap: skillGap,
        is_retest: assessment.is_retest ?? false,
      })
      .select('id')
      .single();

    if (scorecardError) {
      console.error('Error saving scorecard:', scorecardError);
      return new Response(
        JSON.stringify({ error: 'Failed to save scorecard' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Turn each roadmap stage into a real task the student can start/upload
    // proof for, instead of leaving the roadmap as read-only text.
    try {
      const stages = JSON.parse(roadmap) as { title: string; why: string; action: string }[];
      const isFallback = stages.length === 1 && stages[0].title === 'Clean sweep';
      if (!isFallback) {
        const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const taskRows = stages.map((s, i) => ({
          student_id: profile.id,
          title: `Roadmap: ${s.title}`,
          description: `${s.why}\n\nAction: ${s.action}`,
          due_date: dueDate,
          xp_reward: 30,
          roadmap_scorecard_id: scorecard.id,
          roadmap_stage_index: i,
        }));
        const { error: taskInsertError } = await supabase.from('tasks').insert(taskRows);
        if (taskInsertError) console.error('Roadmap task creation failed:', taskInsertError);
      }
    } catch (e) {
      console.error('Roadmap task creation failed:', e);
    }

    // Put them on the level map.
    //
    // The roadmap above says what they just got wrong. This says where they are:
    // "level 7 of 16" instead of "here are four mistakes". A skill they claimed
    // and did not fumble counts as proved and gets ticked off, so the path starts
    // at the first real gap rather than at level 1 for everybody.
    let placements: Awaited<ReturnType<typeof placeStudent>> = [];
    try {
      const weakSkillText = weakQuestions.map((q: any) => normSkill(q.prompt)).join(' | ');
      const provedSkills = ((resumeClaim?.skills as string[] | null) ?? []).filter(
        (s) => !weakSkillText.includes(normSkill(s)),
      );

      const { data: levelProfile } = await supabase
        .from('student_profiles')
        .select('key_interests')
        .eq('id', profile.id)
        .maybeSingle();

      placements = await placeStudent(supabase, profile.id, {
        interests: (levelProfile?.key_interests as string[] | null) ?? [],
        skills: provedSkills,
        resume: {
          skills: (resumeClaim?.skills as string[] | null) ?? [],
          projects: (resumeClaim?.projects as any[] | null) ?? [],
          certifications: (resumeClaim?.certifications as string[] | null) ?? [],
        },
      });
    } catch (e) {
      // A failed placement must not cost them the scorecard they just earned —
      // the map can place them on their next visit.
      console.error('Level placement failed:', e);
    }

    console.log('Assessment graded, scorecard saved:', scorecard.id);

    return new Response(
      JSON.stringify({
        success: true,
        level_placements: placements,
        assessment_id: assessment.id,
        scorecard_id: scorecard.id,
        answer_scores: answerScores,
        skill_proof_score: skillProofScore,
        project_proof_score: projectProofScore,
        reasoning_score: reasoningScore,
        interview_readiness_score: interviewReadinessScore,
        resume_quality_score: resumeClaim?.resume_quality_score ?? null,
        ats_match_score: resumeClaim?.ats_match_score ?? null,
        roadmap,
        skill_gap: skillGap,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-assessment-submit:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
