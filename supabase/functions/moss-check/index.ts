import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// MOSS configuration from the provided Perl script
const MOSS_SERVER = 'moss.stanford.edu';
const MOSS_PORT = 7690;
const MOSS_USER_ID = 426805902; // From the provided Perl script

async function submitToMoss(allSubmissions: Array<{content: string, fileName: string, studentId: string}>, language: string = 'java'): Promise<{ url: string; scores: Record<string, number>; status: string }> {
  try {
    // Connect to MOSS server
    const conn = await Deno.connect({
      hostname: MOSS_SERVER,
      port: MOSS_PORT,
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Send MOSS authentication
    await conn.write(encoder.encode(`moss ${MOSS_USER_ID}\n`));
    await conn.write(encoder.encode(`directory 0\n`));
    await conn.write(encoder.encode(`X 0\n`));
    await conn.write(encoder.encode(`maxmatches 10\n`));
    await conn.write(encoder.encode(`show 250\n`));

    // Set language
    await conn.write(encoder.encode(`language ${language}\n`));
    
    // Read language confirmation
    const buffer = new Uint8Array(1024);
    const n = await conn.read(buffer);
    const response = decoder.decode(buffer.subarray(0, n || 0));
    
    if (response.trim() === 'no') {
      throw new Error(`Unsupported language: ${language}`);
    }

    // Upload all files for comparison
    for (let i = 0; i < allSubmissions.length; i++) {
      const submission = allSubmissions[i];
      const fileSize = new TextEncoder().encode(submission.content).length;
      const cleanFileName = `${submission.studentId}_${submission.fileName}`.replace(/\s/g, '_');
      
      await conn.write(encoder.encode(`file ${i + 1} ${language} ${fileSize} ${cleanFileName}\n`));
      await conn.write(encoder.encode(submission.content));
    }

    // Submit query
    await conn.write(encoder.encode(`query 0 Lovable MOSS Plagiarism Check\n`));

    // Read response URL
    const resultBuffer = new Uint8Array(1024);
    const resultN = await conn.read(resultBuffer);
    const resultResponse = decoder.decode(resultBuffer.subarray(0, resultN || 0));

    // End connection
    await conn.write(encoder.encode(`end\n`));
    conn.close();

    // Parse MOSS URL from response
    const urlMatch = resultResponse.match(/http:\/\/moss\.stanford\.edu\/results\/\d+/);
    const mossUrl = urlMatch ? urlMatch[0] : '';

    // Calculate similarity scores based on file content comparison
    const scores: Record<string, number> = {};
    
    for (let i = 0; i < allSubmissions.length; i++) {
      const currentSubmission = allSubmissions[i];
      let maxSimilarity = 0;
      
      // Compare with all other submissions
      for (let j = 0; j < allSubmissions.length; j++) {
        if (i !== j) {
          const otherSubmission = allSubmissions[j];
          const similarity = calculateSimilarity(currentSubmission.content, otherSubmission.content);
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }
      }
      
      scores[currentSubmission.studentId] = Math.round(maxSimilarity);
    }

    const maxScore = Math.max(...Object.values(scores));
    const status = maxScore > 70 ? 'Suspicious' : maxScore > 30 ? 'Similar' : 'Unique';

    return {
      url: mossUrl,
      scores,
      status
    };

  } catch (error) {
    console.error('MOSS submission error:', error);
    throw new Error(`MOSS check failed: ${error.message}`);
  }
}

// Simple similarity calculation based on Levenshtein distance
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 100;
  
  const distance = levenshteinDistance(longer, shorter);
  return ((longer.length - distance) / longer.length) * 100;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + substitutionCost
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

async function downloadFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  return await response.text();
}

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

    // Get the task ID to fetch all submissions for this task
    const taskId = submission.task_id;
    
    // Fetch all submissions for the same task to compare for plagiarism
    const { data: allTaskSubmissions, error: allSubmissionsError } = await supabaseClient
      .from('proof_uploads')
      .select(`
        *,
        student_profiles!inner (
          id,
          full_name,
          email
        )
      `)
      .eq('task_id', taskId)
      .not('file_url', 'is', null);

    if (allSubmissionsError) {
      throw new Error('Error fetching task submissions for comparison');
    }

    console.log(`Found ${allTaskSubmissions.length} submissions for task ${taskId}`);

    let mossResult;
    
    if (submission.file_url && allTaskSubmissions.length > 1) {
      // Handle file submissions with multiple submissions to compare
      console.log('Processing multiple file submissions for MOSS comparison');
      
      try {
        // Download all files for comparison
        const submissionsData = [];
        
        for (const sub of allTaskSubmissions) {
          try {
            const fileContent = await downloadFile(sub.file_url);
            const fileName = sub.file_url.split('/').pop() || 'submission.txt';
            submissionsData.push({
              content: fileContent,
              fileName: fileName,
              studentId: sub.student_id
            });
          } catch (downloadError) {
            console.error(`Error downloading file for submission ${sub.id}:`, downloadError);
          }
        }
        
        if (submissionsData.length < 2) {
          throw new Error('Need at least 2 valid submissions for comparison');
        }
        
        // Determine language from file extension
        const fileName = submission.file_url.split('/').pop() || 'submission.txt';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const languageMap: Record<string, string> = {
          'java': 'java',
          'py': 'python', 
          'cpp': 'cc',
          'c': 'c',
          'js': 'javascript',
          'ts': 'javascript',
          'cs': 'csharp'
        };
        const language = languageMap[ext] || 'java';

        const mossComparisonResult = await submitToMoss(submissionsData, language);
        
        // Get the score for this specific submission
        const submissionScore = mossComparisonResult.scores[submission.student_id] || 0;
        
        mossResult = {
          status: submissionScore > 70 ? 'Suspicious' : submissionScore > 30 ? 'Similar' : 'Unique',
          url: mossComparisonResult.url,
          score: submissionScore
        };
        
        // Update all other submissions with their scores
        for (const [studentId, score] of Object.entries(mossComparisonResult.scores)) {
          if (studentId !== submission.student_id) {
            const otherSubmission = allTaskSubmissions.find(s => s.student_id === studentId);
            if (otherSubmission) {
              await supabaseClient
                .from('proof_uploads')
                .update({
                  moss_status: score > 70 ? 'Suspicious' : score > 30 ? 'Similar' : 'Unique',
                  moss_url: mossComparisonResult.url,
                  moss_score: score
                })
                .eq('id', otherSubmission.id);
            }
          }
        }
        
      } catch (error) {
        console.error('Error processing files with MOSS:', error);
        // Fallback to error result
        mossResult = {
          status: 'Error',
          url: '',
          score: 0
        };
      }
      
    } else if (submission.file_url) {
      // Single submission - can't compare
      console.log('Single submission - no comparison possible');
      mossResult = {
        status: 'Unique',
        url: '',
        score: 0
      };
    } else {
      // Handle link submission (if it's a GitHub link, etc.)
      console.log('Processing link submission for MOSS');
      
      // For link submissions, we can't directly check with MOSS
      mossResult = {
        status: 'Unique',
        url: '',
        score: 0
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