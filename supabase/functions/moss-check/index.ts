import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function submitToMossAPI(repoUrl: string, language: string = 'javascript'): Promise<{ similarity_score: number; report_url: string }> {
  const mossApiUrl = Deno.env.get('MOSS_API_URL');
  
  if (!mossApiUrl) {
    throw new Error('MOSS_API_URL environment variable is not set');
  }

  console.log('Calling MOSS Wrapper with:', repoUrl);
  console.log('Submitting to MOSS API:', mossApiUrl);

  try {
    const response = await fetch(mossApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo_url: repoUrl,
        language: language || 'javascript'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MOSS API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('MOSS API Response:', result);

    return {
      similarity_score: result.similarity_score || 0,
      report_url: result.report_url || ''
    };

  } catch (error) {
    console.error('MOSS API submission error:', error);
    throw new Error(`MOSS check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function logAuditEvent(supabaseClient: any, userId: string | null, action: string, details: any) {
  try {
    await supabaseClient
      .from('audit_logs')
      .insert({
        user_id: userId,
        action: action,
        table_name: 'proof_uploads',
        record_id: details.submission_id,
        new_values: details
      });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
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

  let submissionId: string | undefined;

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Require authenticated caller with admin or college_admin role
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id);
    if (!(roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'college_admin')) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const requestBody = await req.json();
    submissionId = requestBody.submissionId;

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

    // Log start of verification
    await logAuditEvent(supabaseClient, null, 'MOSS_VERIFICATION_START', {
      submission_id: submissionId,
      task_id: submission.task_id,
      student_id: submission.student_id
    });

    // Get the task ID to fetch all submissions for this task
    const taskId = submission.task_id;
    
    // Fetch all submissions for the same task to compare for plagiarism
    const { data: allTaskSubmissions, error: allSubmissionsError } = await supabaseClient
      .from('proof_uploads')
      .select('*')
      .eq('task_id', taskId)
      .not('file_url', 'is', null);

    if (allSubmissionsError) {
      throw new Error('Error fetching task submissions for comparison');
    }

    console.log(`Found ${allTaskSubmissions.length} submissions for task ${taskId}`);

    let mossResult;
    
    if (submission.file_url) {
      console.log('Processing file submission for MOSS check');
      
      try {
        // Determine language from file extension or GitHub repo
        let language = 'javascript'; // default
        
        if (submission.file_url.includes('github.com')) {
          // For GitHub repos, try to detect language from repo structure
          const urlParts = submission.file_url.toLowerCase();
          if (urlParts.includes('python') || urlParts.includes('.py')) {
            language = 'python';
          } else if (urlParts.includes('java') || urlParts.includes('.java')) {
            language = 'java';
          } else if (urlParts.includes('cpp') || urlParts.includes('c++') || urlParts.includes('.cpp')) {
            language = 'c';
          }
        } else {
          // For direct file uploads, detect from extension
          const fileName = submission.file_url.split('/').pop() || 'submission.txt';
          const ext = fileName.split('.').pop()?.toLowerCase() || '';
          const languageMap: Record<string, string> = {
            'java': 'java',
            'py': 'python', 
            'cpp': 'c',
            'c': 'c',
            'js': 'javascript',
            'ts': 'javascript',
            'cs': 'csharp',
            'rb': 'ruby',
            'go': 'go',
            'php': 'php'
          };
          language = languageMap[ext] || 'javascript';
        }

        console.log(`Detected language: ${language}`);

        // Submit to MOSS API wrapper with repo URL
        const apiResult = await submitToMossAPI(submission.file_url, language);
        
        mossResult = {
          similarity_score: apiResult.similarity_score,
          report_url: apiResult.report_url,
          status: 'completed'
        };

        // Log successful verification
        await logAuditEvent(supabaseClient, null, 'MOSS_VERIFICATION_SUCCESS', {
          submission_id: submissionId,
          similarity_score: apiResult.similarity_score,
          report_url: apiResult.report_url
        });
        
      } catch (error) {
        console.error('Error processing files with MOSS API:', error);
        
        // Log error
        await logAuditEvent(supabaseClient, null, 'MOSS_VERIFICATION_ERROR', {
          submission_id: submissionId,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // Fallback to error result
        mossResult = {
          similarity_score: 0,
          report_url: '',
          status: 'error'
        };
      }
      
    } else {
      // Handle link submission (no file to check)
      console.log('Link submission - skipping MOSS check');
      
      mossResult = {
        similarity_score: 0,
        report_url: '',
        status: 'completed'
      };

      await logAuditEvent(supabaseClient, null, 'MOSS_VERIFICATION_SKIPPED', {
        submission_id: submissionId,
        reason: 'Link submission'
      });
    }

    console.log('MOSS Result:', mossResult);

    // Update submission with MOSS results
    const { error: updateError } = await supabaseClient
      .from('proof_uploads')
      .update({
        moss_status: mossResult.status,
        moss_url: mossResult.report_url,
        moss_score: mossResult.similarity_score
      })
      .eq('id', submissionId);

    if (updateError) {
      console.error('Error updating submission with MOSS results:', updateError);
      throw updateError;
    }

    return new Response(JSON.stringify({
      moss_score: mossResult.similarity_score,
      moss_url: mossResult.report_url,
      moss_status: mossResult.status
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in moss-check function:', error);
    
    // Log error to audit logs
    if (submissionId) {
      try {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );
        
        await logAuditEvent(supabaseClient, null, 'MOSS_VERIFICATION_ERROR', {
          submission_id: submissionId,
          error: error instanceof Error ? error.message : String(error)
        });
        
        await supabaseClient
          .from('proof_uploads')
          .update({ moss_status: 'error' })
          .eq('id', submissionId);
      } catch (updateError) {
        console.error('Error updating submission status to error:', updateError);
      }
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});