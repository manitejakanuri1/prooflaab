import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AssignTasksRequest {
  mode: 'manual' | 'ai' | 'template' | 'personalized';
  // Common fields
  due_date: string;
  selected_students: string[];
  xp_reward?: number;
  category?: string;
  visibility?: string;
  
  // Manual mode
  title?: string;
  description?: string;
  
  // AI mode
  keywords?: string;
  branch?: string;
  
  // Template mode
  template_id?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')!;

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Verify user authentication and role
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (userError || !user) {
      throw new Error('Invalid authentication');
    }

    // Check user role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData || !['admin', 'college_admin', 'startup'].includes(roleData.role)) {
      throw new Error('Insufficient permissions');
    }

    const requestData: AssignTasksRequest = await req.json();
    const { 
      mode, 
      due_date, 
      selected_students, 
      xp_reward = 50,
      category = 'General', 
      visibility = 'private' 
    } = requestData;

    // Validate required fields
    if (!due_date) {
      throw new Error('Due date is required');
    }

    console.log(`Processing task assignment in ${mode} mode for ${selected_students.length} students`);

    const createdTasks: any[] = [];
    const assignments: any[] = [];
    const currentTime = new Date().toISOString();

    // Helper function to call Gemini API
    async function generateWithGemini(prompt: string): Promise<{ title: string; description: string }> {
      if (!geminiApiKey) {
        console.error('GEMINI_API_KEY environment variable not set');
        throw new Error('Gemini API key not configured');
      }

      console.log('Making Gemini API request with prompt length:', prompt.length);
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`;
      
      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        }
      };
      
      console.log('Request body:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error response:', errorText);
        throw new Error('AI generation failed. Please try again or use manual mode.');
      }

      const data = await response.json();
      console.log('Gemini API response data:', JSON.stringify(data, null, 2));
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        console.error('No text in Gemini response:', JSON.stringify(data, null, 2));
        throw new Error('AI generation failed. Please try again or use manual mode.');
      }

      console.log('Generated text:', text);

      // Parse the response to extract title and description
      const lines = text.split('\n').filter((line: string) => line.trim());
      const titleLine = lines.find((line: string) => line.toLowerCase().startsWith('title:'));
      const descriptionLine = lines.find((line: string) => line.toLowerCase().startsWith('description:'));
      
      let title = 'Generated Task';
      let description = text.trim();
      
      if (titleLine) {
        title = titleLine.replace(/^title:\s*/i, '').trim();
      }
      
      if (descriptionLine) {
        description = descriptionLine.replace(/^description:\s*/i, '').trim();
        // If there are multiple lines starting from description, join them
        const descIndex = lines.findIndex((line: string) => line.toLowerCase().startsWith('description:'));
        if (descIndex >= 0 && descIndex < lines.length - 1) {
          const descLines = [descriptionLine.replace(/^description:\s*/i, '').trim()];
          for (let i = descIndex + 1; i < lines.length; i++) {
            if (!lines[i].toLowerCase().startsWith('title:') && !lines[i].toLowerCase().startsWith('description:')) {
              descLines.push(lines[i].trim());
            }
          }
          description = descLines.join(' ').trim();
        }
      }

      console.log('Parsed title:', title);
      console.log('Parsed description:', description);

      return { title, description };
    }

    // Helper function to get student profiles
    async function getStudentProfiles(studentIds: string[]) {
      const { data, error } = await supabase
        .from('student_profiles')
        .select('id, full_name, branch, year_of_study, key_interests, preferred_skills, career_goals')
        .in('id', studentIds);
      
      if (error) throw error;
      return data || [];
    }

    // Helper function to insert task
    async function insertTask(taskData: any) {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          title: taskData.title,
          description: taskData.description,
          due_date: due_date,
          status: 'pending',
          xp_reward: taskData.xp_reward || 0,
          created_at: currentTime,
          updated_at: currentTime,
          duration_days: 7,
          upload_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          created_by_college_id: roleData?.role === 'college_admin' ? user?.id || null : null,
          created_by_admin_id: roleData?.role === 'admin' ? user?.id || null : null,
          created_by_startup_id: roleData?.role === 'startup' ? user?.id || null : null,
          is_paid: false,
          required_skills: [],
          posted_at: currentTime,
          category,
          visibility,
          approved_by_admin: true,
          source: taskData.source,
          ai_metadata: taskData.ai_metadata || null
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    // Helper function to insert task assignments
    async function insertAssignments(taskId: string, studentIds: string[]) {
      const assignmentData = studentIds.map(studentId => ({
        task_id: taskId,
        student_id: studentId,
        status: 'assigned',
        assigned_at: currentTime,
        updated_at: currentTime,
        completed_at: null,
        submitted_at: null,
        review_status: null,
        reviewed_by: null,
        feedback: null
      }));

      const { data, error } = await supabase
        .from('task_assignments')
        .insert(assignmentData)
        .select();

      if (error) throw error;
      return data || [];
    }

    switch (mode) {
      case 'manual': {
        const { title, description } = requestData;
        
        if (!title || !description) {
          throw new Error('Title and description are required for manual mode');
        }

        console.log('Creating manual task:', title);
        
        const task = await insertTask({
          title,
          description,
          xp_reward,
          source: 'manual'
        });

        createdTasks.push(task);
        
        // Only assign if students are selected
        if (selected_students.length > 0) {
          const taskAssignments = await insertAssignments(task.id, selected_students);
          assignments.push(...taskAssignments);
        }
        break;
      }

      case 'ai': {
        const { keywords, branch } = requestData;
        
        if (!keywords) {
          throw new Error('Keywords are required for AI mode');
        }

        console.log('Generating AI task with keywords:', keywords);
        
        const prompt = `Generate a mini-project style task for engineering students with the following format:

Title: A short, clear, and professional project name (4–8 words, avoid "Challenge").
Description: A detailed explanation (3–5 sentences) including:
- The main goal of the task.
- Expected deliverables (e.g., code, report, prototype).
- Technologies/tools to use (related to the keywords).
- A real-world application or why it matters.

Constraints:
- Keep it student-appropriate (not enterprise-level).
- Make it actionable within 7–10 days.
- Relate it to the student's branch: ${branch || 'Computer Science'}.
- Focus on the topic keywords: ${keywords}.

Please respond in exactly this format:
Title: [Your title here]
Description: [Your description here]`;

        const { title, description } = await generateWithGemini(prompt);
        
        const aiMetadata = {
          keywords,
          branch: branch || 'Computer Science',
          generated_at: currentTime,
          prompt_used: prompt
        };
        
        const task = await insertTask({
          title,
          description,
          xp_reward,
          source: 'ai',
          ai_metadata: aiMetadata
        });

        createdTasks.push(task);
        
        // Only assign if students are selected
        if (selected_students.length > 0) {
          const taskAssignments = await insertAssignments(task.id, selected_students);
          assignments.push(...taskAssignments);
        }
        break;
      }

      case 'template': {
        const { template_id } = requestData;
        
        if (!template_id) {
          throw new Error('Template ID is required for template mode');
        }

        console.log('Creating task from template:', template_id);
        
        // Get template
        const { data: template, error: templateError } = await supabase
          .from('task_templates')
          .select('*')
          .eq('id', template_id)
          .single();

        if (templateError || !template) {
          throw new Error('Template not found');
        }

        const task = await insertTask({
          title: template.title,
          description: template.description,
          xp_reward: template.xp_reward || xp_reward,
          source: 'template'
        });

        createdTasks.push(task);
        
        if (selected_students.length > 0) {
          const taskAssignments = await insertAssignments(task.id, selected_students);
          assignments.push(...taskAssignments);
        }
        break;
      }

      case 'personalized': {
        console.log('Generating personalized tasks for students');
        
        // Get student profiles
        const students = await getStudentProfiles(selected_students);
        
        for (const student of students) {
          const prompt = `Name: ${student.full_name}
Branch: ${student.branch || 'General'}
Year: ${student.year_of_study || 'Not specified'}
Interests: ${student.key_interests?.join(', ') || 'General programming'}
Skills: ${student.preferred_skills?.join(', ') || 'Basic programming'}
Career Goals: ${student.career_goals || 'Software development'}

Generate a personalized mini-project with:
Title: [short professional title]
Description: [detailed, clear requirements, tools, real-world relevance]

The task should:
1. Align with their interests and career goals
2. Be appropriate for their year of study
3. Help develop their preferred skills
4. Be engaging and educational
5. Be completable in 7-10 days

Please provide:
Title: [A personalized, engaging task title]
Description: [A detailed description tailored specifically to this student's profile, including clear objectives, requirements, and how it relates to their goals.]`;

          const { title, description } = await generateWithGemini(prompt);
          
          const aiMetadata = {
            student_profile: {
              full_name: student.full_name,
              branch: student.branch,
              year_of_study: student.year_of_study,
              key_interests: student.key_interests,
              preferred_skills: student.preferred_skills,
              career_goals: student.career_goals
            },
            generated_at: currentTime,
            prompt_used: prompt
          };
          
          const task = await insertTask({
            title: `${title} (for ${student.full_name})`,
            description,
            xp_reward,
            source: 'personalized',
            ai_metadata: aiMetadata
          });

          createdTasks.push(task);
          const taskAssignments = await insertAssignments(task.id, [student.id]);
          assignments.push(...taskAssignments);
        }
        break;
      }

      default:
        throw new Error('Invalid mode specified');
    }

    console.log(`Successfully created ${createdTasks.length} tasks and ${assignments.length} assignments`);

    return new Response(JSON.stringify({
      success: true,
      created_tasks: createdTasks.length,
      assignments: assignments.length,
      tasks: createdTasks,
      task_assignments: assignments
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in assign-tasks function:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Better error handling to show actual error details
    let errorMessage = 'An unexpected error occurred';
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null) {
      errorMessage = JSON.stringify(error);
    } else {
      errorMessage = String(error);
    }
    
    // Check if it's an AI generation error
    if (errorMessage.includes('Gemini') || errorMessage.includes('AI') || errorMessage.includes('generateContent')) {
      errorMessage = 'AI generation failed. Please try again or use manual mode.';
    }

    return new Response(JSON.stringify({
      success: false,
      created_tasks: 0,
      assignments: 0,
      tasks: [],
      task_assignments: [],
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});