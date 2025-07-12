import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { submissionId } = await req.json();
    const mossUserId = Deno.env.get('MOSS_USER_ID');

    if (!mossUserId) {
      throw new Error('MOSS_USER_ID not configured');
    }

    console.log(`Processing MOSS check for submission: ${submissionId}`);

    // Get submission details
    const { data: submission, error: submissionError } = await supabaseClient
      .from('proof_uploads')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (submissionError || !submission) {
      throw new Error('Submission not found');
    }

    // Update submission to show MOSS is pending
    await supabaseClient
      .from('proof_uploads')
      .update({ moss_status: 'Pending' })
      .eq('id', submissionId);

    let mossResult;
    
    if (submission.file_url) {
      // Handle file submission
      console.log('Processing file submission for MOSS');
      
      // For demo purposes, we'll simulate MOSS analysis
      // In real implementation, you would:
      // 1. Download the file from the URL
      // 2. Send it to MOSS via their Perl script or API
      // 3. Parse the results
      
      // Simulated MOSS response
      const simulatedScore = Math.floor(Math.random() * 100);
      const simulatedUrl = `https://moss.stanford.edu/results/${Date.now()}`;
      
      let status = 'Unique';
      if (simulatedScore > 80) status = 'Suspicious';
      else if (simulatedScore > 50) status = 'Similar';
      
      mossResult = {
        score: simulatedScore,
        url: simulatedUrl,
        status: status
      };
      
      // In a real implementation, here's how you would integrate with MOSS:
      /*
      // 1. Download the file
      const fileResponse = await fetch(submission.file_url);
      const fileContent = await fileResponse.text();
      
      // 2. Create temporary file for MOSS
      const tempFile = await Deno.makeTempFile({ suffix: '.java' });
      await Deno.writeTextFile(tempFile, fileContent);
      
      // 3. Run MOSS (this would require the MOSS Perl script)
      const mossCommand = new Deno.Command("perl", {
        args: [
          "moss.pl", 
          "-l", "java", 
          "-u", mossUserId,
          tempFile
        ],
        stdout: "piped",
        stderr: "piped",
      });
      
      const { code, stdout, stderr } = await mossCommand.output();
      const mossOutput = new TextDecoder().decode(stdout);
      
      // 4. Parse MOSS results
      const urlMatch = mossOutput.match(/http:\/\/moss\.stanford\.edu\/results\/\d+/);
      const mossUrl = urlMatch ? urlMatch[0] : null;
      
      // 5. Fetch results page to get similarity score
      if (mossUrl) {
        const resultsResponse = await fetch(mossUrl);
        const resultsHtml = await resultsResponse.text();
        // Parse HTML to extract similarity scores
      }
      */
      
    } else {
      // Handle link submission (if it's a GitHub link, etc.)
      console.log('Processing link submission for MOSS');
      
      // Simulated result for link submissions
      const simulatedScore = Math.floor(Math.random() * 60); // Links tend to have lower similarity
      const simulatedUrl = `https://moss.stanford.edu/results/${Date.now()}`;
      
      let status = 'Unique';
      if (simulatedScore > 70) status = 'Suspicious';
      else if (simulatedScore > 40) status = 'Similar';
      
      mossResult = {
        score: simulatedScore,
        url: simulatedUrl,
        status: status
      };
    }

    console.log('MOSS Result:', mossResult);

    // Update submission with MOSS results
    const { error: updateError } = await supabaseClient
      .from('proof_uploads')
      .update({
        moss_status: mossResult.status,
        moss_url: mossResult.url,
        moss_score: mossResult.score
      })
      .eq('id', submissionId);

    if (updateError) {
      console.error('Error updating submission with MOSS results:', updateError);
      throw updateError;
    }

    return new Response(JSON.stringify(mossResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in moss-check function:', error);
    
    // Update submission to show error
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      
      const { submissionId } = await req.json();
      if (submissionId) {
        await supabaseClient
          .from('proof_uploads')
          .update({ moss_status: 'Error' })
          .eq('id', submissionId);
      }
    } catch (updateError) {
      console.error('Error updating submission status to error:', updateError);
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});