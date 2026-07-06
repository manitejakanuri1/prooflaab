import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      answered_at: new Date().toISOString()
    }));

    // Update conceptual_tests
    const { error: updateError } = await supabase
      .from('conceptual_tests')
      .update({
        student_answers: timestampedAnswers,
        status: 'submitted'
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

    // Create notification for student
    if (proofData) {
      await supabase
        .from('notifications')
        .insert({
          student_id: proofData.student_id,
          type: 'verification',
          title: 'Answers Submitted ✅',
          message: 'Your conceptual answers have been submitted and are being evaluated.',
          link: `/student/uploads`,
          is_read: false
        });
    }

    // Automatically trigger evaluation
    console.log('Triggering automatic evaluation...');
    const evalResult = await supabase.functions.invoke('response-evaluator', {
      body: { proof_id }
    });

    if (evalResult.error) {
      console.error('Evaluation error:', evalResult.error);
      // Don't fail the submission even if evaluation fails
    } else {
      console.log('Evaluation triggered successfully');
      
      // Trigger trust computation after evaluation
      const trustResult = await supabase.functions.invoke('trust-compute', {
        body: { proof_id }
      });
      
      if (trustResult.error) {
        console.error('Trust computation error:', trustResult.error);
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