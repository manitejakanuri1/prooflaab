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
    // Due date is only required when actually assigning tasks (selected_students > 0)
    // For AI generation preview, due_date can be optional
    if (!due_date && selected_students && selected_students.length > 0) {
      throw new Error('Due date is required when assigning tasks');
    }

    console.log(`Processing task assignment in ${mode} mode for ${selected_students.length} students`);

    // Get the appropriate creator ID and source based on role
    let created_by_college_id: string | null = null;
    let created_by_admin_id: string | null = null;
    let created_by_startup_id: string | null = null;
    let source_based_on_role: string;

    if (roleData.role === 'college_admin') {
      const { data: college, error: collegeError } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();
      
      if (collegeError) {
        console.error('Error fetching college:', collegeError);
        created_by_college_id = null;
      } else {
        created_by_college_id = college?.id || null;
      }
      source_based_on_role = 'college';
    } else if (roleData.role === 'admin') {
      created_by_admin_id = user.id;
      source_based_on_role = 'admin';
    } else if (roleData.role === 'startup') {
      created_by_startup_id = user.id;
      source_based_on_role = 'startup';
    } else {
      source_based_on_role = 'manual';
    }

    const createdTasks: any[] = [];
    const assignments: any[] = [];
    const currentTime = new Date().toISOString();

    // Helper function to call Gemini API
    async function generateWithGemini(prompt: string, model: string = 'gemini-flash-latest'): Promise<{ title: string; description: string; model: string }> {
      if (!geminiApiKey) {
        console.error('GEMINI_API_KEY environment variable not set');
        throw new Error('AI generation failed, please retry. (API key not configured)');
      }

      console.log(`Making Gemini API request with model: ${model}, prompt length:`, prompt.length);
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
      
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
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Gemini API response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error response:', errorText);
        throw new Error('AI generation failed, please retry.');
      }

      const data = await response.json();
      console.log('Gemini API response received');
      
      // Check for safety ratings or blocked content
      if (data.promptFeedback?.blockReason) {
        console.error('Content was blocked:', data.promptFeedback.blockReason);
        throw new Error('AI generation failed, please retry. (Content blocked by safety filters)');
      }
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        console.error('No text content in response');
        throw new Error('AI generation failed, please retry.');
      }

      console.log('Generated text from Gemini:', text);

      // Parse Title and Description
      let title = '';
      let description = '';

      const titleMatch = text.match(/(?:^|\n)\s*(?:Title|TITLE):\s*(.+?)(?:\n|$)/i);
      const descMatch = text.match(/(?:^|\n)\s*(?:Description|DESCRIPTION):\s*(.+?)$/is);

      if (titleMatch) {
        title = titleMatch[1].trim();
      } else {
        // Fallback: use first line as title
        const firstLine = text.split('\n')[0].trim();
        if (firstLine.length > 0 && firstLine.length < 200) {
          title = firstLine;
        }
      }

      if (descMatch) {
        description = descMatch[1].trim();
      } else {
        // Fallback: use everything after the first line
        const lines = text.split('\n');
        if (lines.length > 1) {
          description = lines.slice(1).join('\n').trim();
        }
      }

      // Validate we got proper content
      if (!title || title.length < 3) {
        console.error('Failed to extract valid title');
        throw new Error('AI generation failed, please retry.');
      }
      
      if (!description || description.length < 20) {
        console.error('Failed to extract valid description');
        throw new Error('AI generation failed, please retry.');
      }

      console.log('Successfully parsed - Title:', title);
      console.log('Successfully parsed - Description length:', description.length);

      return { title, description, model };
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
      // Determine approved_by_admin based on creator
      const approvedByAdmin = true; // Default to true for all creators
      
      // Determine the correct source based on role if not provided
      const finalSource = taskData.source || source_based_on_role;
      
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          title: taskData.title,
          description: taskData.description,
          due_date: due_date,
          status: 'Pending', // Will be overridden by trigger based on verification
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
          approved_by_admin: approvedByAdmin,
          source: finalSource,
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

        // Validate title length
        const trimmedTitle = title.trim();
        if (trimmedTitle.length < 3) {
          throw new Error('Task title must be at least 3 characters long');
        }
        if (trimmedTitle.length > 200) {
          throw new Error('Task title must not exceed 200 characters');
        }

        // Validate description length
        const trimmedDescription = description.trim();
        if (trimmedDescription.length < 20) {
          throw new Error('Task description must be at least 20 characters long');
        }

        console.log('Creating manual task:', trimmedTitle);
        
        const task = await insertTask({
          title: trimmedTitle,
          description: trimmedDescription,
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

        const { title, description, model } = await generateWithGemini(prompt, 'gemini-flash-latest');
        
        const aiMetadata = {
          model: model,
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
        
        if (selected_students.length === 0) {
          throw new Error('At least one student must be selected for personalized mode');
        }
        
        // Get student profiles
        const students = await getStudentProfiles(selected_students);
        
        if (students.length === 0) {
          throw new Error('No student profiles found. Students need to complete their profiles first.');
        }
        
        for (const student of students) {
          console.log('Generating personalized mini-project for:', student.full_name);
          
          const prompt = `Create a personalized mini-project task for this specific student based on their profile and interests.

STUDENT PROFILE:
Name: ${student.full_name}
Branch: ${student.branch || 'Computer Science'}
Year of Study: ${student.year_of_study || 'Not specified'}
Key Interests: ${Array.isArray(student.key_interests) ? student.key_interests.join(', ') : 'General programming'}
Preferred Skills: ${Array.isArray(student.preferred_skills) ? student.preferred_skills.join(', ') : 'Basic programming'}
Career Goals: ${student.career_goals || 'Software development'}

MINI-PROJECT REQUIREMENTS:
- Duration: 7-10 days to complete
- Must be a hands-on coding/development project (NOT just theory or research)
- Align with student's interests, skills, and career goals
- Match their current year of study and skill level
- Include specific deliverables (code, documentation, working prototype)
- Connect to real-world applications in their field of interest
- Be challenging but achievable for their level

RESPONSE FORMAT (MUST follow exactly):
Title: [Write a clear, specific mini-project title that reflects the student's interests. Do NOT add student name to title.]
Description: [Write a comprehensive 4-6 sentence description that includes: 
1. The main project objective and what they will build
2. Specific technical deliverables (e.g., "Create a working web application with X, Y, Z features")
3. Technologies and skills they will use and learn
4. How this project connects to their career goals and real-world applications
5. Any special requirements or constraints
Make it personalized and motivating for THIS specific student.]

EXAMPLE FORMAT:
Title: React-Based Student Portfolio Dashboard
Description: Build a comprehensive personal portfolio website using React.js that showcases your projects, skills, and achievements with interactive visualizations. The deliverables include a fully functional React application with at least 5 components, responsive design, and integration with a REST API to fetch your GitHub repositories. You will use modern React hooks, React Router for navigation, and Chart.js for data visualization. This project directly supports your goal of becoming a frontend developer by building a professional portfolio piece that demonstrates your React expertise to potential employers. Deploy the application to Netlify or Vercel for live demonstration.

Now generate a personalized mini-project for ${student.full_name}:`;

          try {
            const { title, description, model } = await generateWithGemini(prompt, 'gemini-flash-latest');
            
            const aiMetadata = {
              model: model,
              student_profile: {
                full_name: student.full_name,
                branch: student.branch,
                year_of_study: student.year_of_study,
                key_interests: student.key_interests,
                preferred_skills: student.preferred_skills,
                career_goals: student.career_goals
              },
              generated_at: currentTime,
              prompt_type: 'personalized_mini_project'
            };
            
            const task = await insertTask({
              title: title,
              description: description,
              xp_reward,
              source: 'personalized',
              ai_metadata: aiMetadata
            });

            createdTasks.push(task);
            const taskAssignments = await insertAssignments(task.id, [student.id]);
            assignments.push(...taskAssignments);
            
            console.log(`Successfully created personalized task for ${student.full_name}`);
          } catch (error) {
            console.error(`Failed to generate task for ${student.full_name}:`, error);
            throw new Error(`AI generation failed for ${student.full_name}, please retry.`);
          }
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