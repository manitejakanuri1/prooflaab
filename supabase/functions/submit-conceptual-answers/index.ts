import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { proof_id, answers } = await req.json();

    // Validation
    if (!proof_id) {
      return new Response(
        JSON.stringify({ error: 'Missing proof_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty answers array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate each answer has required fields
    for (const answer of answers) {
      if (!answer.question_id || !answer.answer_text) {
        return new Response(
          JSON.stringify({ error: 'Each answer must have question_id and answer_text' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get auth user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get student_id from user_id
    const { data: studentProfile, error: profileError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !studentProfile) {
      return new Response(
        JSON.stringify({ error: 'Student profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const student_id = studentProfile.id;

    // Ownership check: ensure the proof_id belongs to this student
    const { data: proofOwner, error: proofOwnerError } = await supabase
      .from('proof_uploads')
      .select('student_id')
      .eq('id', proof_id)
      .single();

    if (proofOwnerError || !proofOwner) {
      return new Response(
        JSON.stringify({ error: 'Proof not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (proofOwner.student_id !== student_id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: proof does not belong to authenticated student' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch conceptual test
    const { data: conceptualTest, error: fetchError } = await supabase
      .from('conceptual_tests')
      .select('*')
      .eq('proof_id', proof_id)
      .single();

    if (fetchError || !conceptualTest) {
      return new Response(
        JSON.stringify({ error: 'Conceptual test not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate status is pending
    if (conceptualTest.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: `Cannot submit answers. Current status: ${conceptualTest.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare answers with timestamps
    const timestampedAnswers = answers.map(answer => ({
      question_id: answer.question_id,
      answer_text: answer.answer_text,
      ...(typeof answer.selected_index === 'number' ? { selected_index: answer.selected_index } : {}),
      answered_at: new Date().toISOString()
    }));

    // MCQ tests are graded here deterministically instead of calling the essay
    // evaluator. The correct answers are NOT in conceptual_tests.questions —
    // that table is readable by the student, so keeping the key there handed
    // them the answers with the questions. They live in conceptual_answer_keys,
    // which only the service role can read.
    const questionList = (conceptualTest.questions ?? []) as any[];

    const { data: keyRow } = await supabase
      .from('conceptual_answer_keys')
      .select('answers')
      .eq('test_id', conceptualTest.id)
      .maybeSingle();

    const correctByQuestion = new Map<string, number>(
      ((keyRow?.answers ?? []) as any[]).map((k: any) => [k.id, k.correct_index])
    );

    const isMcqTest = questionList.length > 0 &&
      questionList.every((q: any) => Array.isArray(q.options)) &&
      correctByQuestion.size > 0;

    let mcqScores: any[] | null = null;
    if (isMcqTest) {
      const questionsById = new Map(questionList.map((q: any) => [q.id, q]));
      mcqScores = answers.map((a: any) => {
        const q = questionsById.get(a.question_id);
        const correct = correctByQuestion.has(a.question_id)
          && a.selected_index === correctByQuestion.get(a.question_id);
        return {
          question_id: a.question_id,
          correctness_score: correct ? 100 : 0,
          ai_likelihood_score: 0,
          confidence: 100,
          explanation: correct
            ? (q?.reinforce ?? 'Correct answer selected')
            : 'Wrong or no option selected within the time limit',
          repo_context_bonus: 0,
          final_score: correct ? 100 : 0
        };
      });
    }

    // Update conceptual_tests
    const { error: updateError } = await supabase
      .from('conceptual_tests')
      .update({
        student_answers: timestampedAnswers,
        ...(mcqScores
          ? { answer_scores: mcqScores, status: 'graded' }
          : { status: 'submitted' })
      })
      .eq('proof_id', proof_id);

    if (updateError) {
      console.error('Error updating conceptual test:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to submit answers' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get proof details for notification
    const { data: proofData } = await supabase
      .from('proof_uploads')
      .select('student_id, task_id, tasks(title)')
      .eq('id', proof_id)
      .single();

    // Create notification for student. notifications is keyed on the auth user
    // id now, not the student profile id.
    if (proofData) {
      const { data: studentAccount } = await supabase
        .from('student_profiles')
        .select('user_id')
        .eq('id', proofData.student_id)
        .maybeSingle();

      if (studentAccount?.user_id) {
        await supabase
          .from('notifications')
          .insert({
            user_id: studentAccount.user_id,
            audience: 'student',
            type: 'verification',
            title: 'Answers Submitted ✅',
            message: 'Your conceptual answers have been submitted and are being evaluated.',
            link: `/student/uploads`
          });
      }
    }

    // Internal function-to-function calls authenticate with the webhook
    // secret — the service-role key is not a user JWT and fails getUser()
    const internalHeaders = { 'x-webhook-secret': Deno.env.get('WEBHOOK_SECRET') ?? '' };

    if (isMcqTest) {
      // Already graded above — go straight to trust computation
      const trustResult = await supabase.functions.invoke('trust-compute', {
        body: { proof_id },
        headers: internalHeaders
      });
      if (trustResult.error) {
        console.error('Trust computation error:', trustResult.error);
      }
    } else {
      // Legacy free-text tests: AI evaluation, then trust computation
      console.log('Triggering automatic evaluation...');
      const evalResult = await supabase.functions.invoke('response-evaluator', {
        body: { proof_id },
        headers: internalHeaders
      });

      if (evalResult.error) {
        console.error('Evaluation error:', evalResult.error);
        // Don't fail the submission even if evaluation fails
      } else {
        console.log('Evaluation triggered successfully');

        const trustResult = await supabase.functions.invoke('trust-compute', {
          body: { proof_id },
          headers: internalHeaders
        });

        if (trustResult.error) {
          console.error('Trust computation error:', trustResult.error);
        }
      }
    }

    // Log to audit_logs
    await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action: 'conceptual_answers_submitted',
        table_name: 'conceptual_tests',
        record_id: proof_id,
        new_values: {
          proof_id,
          submitted_count: answers.length,
          student_id
        }
      });

    console.log(`Student ${student_id} submitted ${answers.length} answers for proof ${proof_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        submitted_count: answers.length,
        proof_id 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in submit-conceptual-answers:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});