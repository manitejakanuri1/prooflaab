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
      visibility = 'public'
    } = requestData;

    // Validate required fields
    if (!due_date) {
      throw new Error('Due date is required');
    }

    console.log(`Processing task assignment in ${mode} mode for ${selected_students.length} students`);

    // Get the appropriate creator ID based on role
    let created_by_college_id: string | null = null;
    let created_by_admin_id: string | null = null;
    let created_by_startup_id: string | null = null;

    if (roleData.role === 'college_admin') {
      const { data: college, error: collegeError } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();
      
      if (collegeError || !college) {
        throw new Error('No college record found for this college admin');
      }
      created_by_college_id = college.id;
    } else if (roleData.role === 'admin') {
      created_by_admin_id = user.id;
    } else if (roleData.role === 'startup') {
      created_by_startup_id = user.id;
    }

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
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`;
      
      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: 1000,
          topK: 40,
          topP: 0.95
        }
      };
      
      console.log('Making Gemini API call to:', apiUrl);
      console.log('Request payload:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Gemini API response status:', response.status);
      console.log('Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error response:', errorText);
        console.error('Full error details:', {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText
        });
        throw new Error(`AI generation failed. Status: ${response.status}. ${errorText}`);
      }

      const data = await response.json();
      console.log('Full Gemini API response:', JSON.stringify(data, null, 2));
      
      // Check for safety ratings or blocked content
      if (data.promptFeedback?.blockReason) {
        console.error('Content was blocked:', data.promptFeedback.blockReason);
        throw new Error('AI generation was blocked due to safety filters. Please try different keywords.');
      }
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        console.error('No text content in response. Full response:', JSON.stringify(data, null, 2));
        throw new Error('AI generation failed - no content generated. Please try again.');
      }

      console.log('Generated text from Gemini:', text);

      // Simplified parsing with better error handling
      let title = 'AI Generated Task';
      let description = text.trim();

      // Try to parse Title and Description
      const titleMatch = text.match(/(?:^|\n)\s*(?:Title|TITLE):\s*(.+?)(?:\n|$)/i);
      const descMatch = text.match(/(?:^|\n)\s*(?:Description|DESCRIPTION):\s*(.+?)$/is);

      if (titleMatch) {
        title = titleMatch[1].trim();
        console.log('Extracted title:', title);
      } else {
        // Fallback: use first line as title
        const firstLine = text.split('\n')[0].trim();
        if (firstLine.length > 0 && firstLine.length < 100) {
          title = firstLine;
          console.log('Using first line as title:', title);
        }
      }

      if (descMatch) {
        description = descMatch[1].trim();
        console.log('Extracted description:', description);
      } else {
        // Fallback: use everything after the first line
        const lines = text.split('\n');
        if (lines.length > 1) {
          description = lines.slice(1).join('\n').trim();
        }
        console.log('Using fallback description:', description);
      }

      // Ensure we have valid content
      if (!title || title === 'AI Generated Task') {
        title = 'AI Generated Programming Task';
      }
      
      if (!description || description.length < 10) {
        description = 'This is an AI-generated programming task. Please complete it according to the requirements and submit your work for review.';
      }

      console.log('Final parsed title:', title);
      console.log('Final parsed description:', description);

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
          status: 'Pending',
          xp_reward: taskData.xp_reward || 0,
          created_at: currentTime,
          updated_at: currentTime,
          duration_days: 7,
          upload_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          created_by_college_id,
          created_by_admin_id,
          created_by_startup_id,
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

        console.log('Generating AI task with keywords:', keywords, 'branch:', branch);
        
        const prompt = `You are a computer science professor creating a mini-project for engineering students. Generate a programming task based on these requirements:

REQUIREMENTS:
- Topic keywords: ${keywords}
- Student branch: ${branch || 'Computer Science'}
- Duration: 7-10 days to complete
- Difficulty: Intermediate level suitable for students
- Must include practical coding/development work

RESPONSE FORMAT (MUST follow this exact format):
Title: [Write a clear 4-8 word project title without using "Challenge" or "Task"]
Description: [Write a detailed 3-5 sentence description that includes: (1) the main objective, (2) specific deliverables like code/report/prototype, (3) technologies to use, (4) real-world application or importance]

EXAMPLE FORMAT:
Title: React E-commerce Product Catalog
Description: Build a dynamic web application that displays and filters product listings using React.js and a REST API. Students must create components for product cards, search functionality, and category filtering. The deliverables include a working React application, clean component architecture, and API integration code. This project teaches modern frontend development skills essential for building user-facing web applications in the e-commerce industry.

Now generate a task for: ${keywords}`;

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
          source: 'manual'
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
        
        if (selected_students.length === 0) {
          throw new Error('At least one student must be selected for personalized mode');
        }
        
        // Get student profiles
        const students = await getStudentProfiles(selected_students);
        
        if (students.length === 0) {
          throw new Error('No student profiles found. Students need to complete their profiles first.');
        }
        
        for (const student of students) {
          console.log('Generating personalized task for:', student.full_name);
          
          const prompt = `You are creating a personalized mini-project for this student. Use their profile to make it relevant and engaging.

STUDENT PROFILE:
Name: ${student.full_name}
Branch: ${student.branch || 'Computer Science'}
Year of Study: ${student.year_of_study || 'Not specified'}
Key Interests: ${Array.isArray(student.key_interests) ? student.key_interests.join(', ') : 'General programming'}
Preferred Skills: ${Array.isArray(student.preferred_skills) ? student.preferred_skills.join(', ') : 'Basic programming'}
Career Goals: ${student.career_goals || 'Software development'}

REQUIREMENTS:
- Create a programming project that aligns with their interests and goals
- Match their year of study and skill level
- Be completable in 7-10 days
- Include hands-on coding work

RESPONSE FORMAT (MUST follow exactly):
Title: [Personalized project title relevant to their interests]
Description: [Detailed description explaining the project objectives, required deliverables, technologies to use, and how it connects to their career goals. Make it specific to this student's profile.]

Generate a personalized task now:`;

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
    console.error('Error object:', typeof error === 'object' ? JSON.stringify(error) : String(error));
    
    let errorMessage = 'An unexpected error occurred';
    let statusCode = 500;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Specific error handling for different types of errors
      if (errorMessage.includes('Authentication') || errorMessage.includes('authorization')) {
        statusCode = 401;
        errorMessage = 'Authentication failed. Please log in again.';
      } else if (errorMessage.includes('Insufficient permissions')) {
        statusCode = 403;
        errorMessage = 'You do not have permission to perform this action.';
      } else if (errorMessage.includes('required')) {
        statusCode = 400;
        errorMessage = 'Missing required fields: ' + errorMessage;
      } else if (errorMessage.includes('AI generation failed') || errorMessage.includes('Gemini') || errorMessage.includes('blocked')) {
        statusCode = 502;
        errorMessage = 'AI service is currently unavailable. Please try manual mode or try again later.';
      } else if (errorMessage.includes('23502') || errorMessage.includes('not-null')) {
        statusCode = 400;
        errorMessage = 'Missing required database fields. Please check your input data.';
      } else if (errorMessage.includes('23514') || errorMessage.includes('check constraint')) {
        statusCode = 400;
        errorMessage = 'Invalid data provided. Please check the values and try again.';
      }
    } else if (typeof error === 'object' && error !== null && 'code' in error) {
      const dbError = error as any;
      console.error('Database error details:', JSON.stringify(dbError, null, 2));
      
      if (dbError.code === '23502') {
        statusCode = 400;
        errorMessage = 'Missing required data. Please ensure all required fields are provided.';
      } else if (dbError.code === '23514') {
        statusCode = 400;
        errorMessage = 'Invalid data format. Please check your input values.';
      } else {
        errorMessage = `Database error: ${dbError.message || 'Unknown database issue'}`;
      }
    }

    return new Response(JSON.stringify({
      success: false,
      created_tasks: 0,
      assignments: 0,
      tasks: [],
      task_assignments: [],
      error: errorMessage
    }), {
      status: statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});