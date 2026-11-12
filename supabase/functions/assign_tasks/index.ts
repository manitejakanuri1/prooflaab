import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { cors } from "../_shared/cors.ts";
import { generateGradedConfig, type AutoConfigMode } from "../_shared/auto-config.ts";
import { explicitCodingProblem } from '../_shared/coding-mode.ts';
import { assignScope, clampTask, targetIds, templateAllowed } from '../_shared/assign-scope.ts';
import { personalMatch, PERSONAL_AI_PER_WEEK } from '../_shared/personal-match.ts';

interface AssignTasksRequest {
  mode: 'manual' | 'template' | 'personalized';
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

  // Personalized mode: answer the plan only, write nothing
  preview?: boolean;
}

serve(async (req) => {
  const corsHeaders = cors(req);
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
    const callerId = user.id;

    // Check user role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData) {
      throw new Error('Insufficient permissions');
    }

    const requestData: AssignTasksRequest = await req.json();
    const {
      mode,
      due_date,
      category = 'General',
    } = requestData;

    // Security gate 14 Oct: the caller's scope is decided, and every target checked, BEFORE any
    // student read, AI call or write. Non-admins cannot choose XP, visibility or approval.
    const selected_students = targetIds(requestData.selected_students);
    const scope = await assignScope(supabase, callerId, roleData.role, selected_students);
    const { xp_reward = 50, visibility = 'public' } = clampTask(scope, {
      xp_reward: requestData.xp_reward, visibility: requestData.visibility,
    });

    // Validate required fields
    // Due date is only required when actually assigning tasks (selected_students > 0)
    // For AI generation preview, due_date can be optional
    if (!due_date && selected_students.length > 0 && requestData.preview !== true) {
      throw new Error('Due date is required when assigning tasks');
    }

    console.log(`Processing task assignment in ${mode} mode for ${selected_students.length} students`);

    const created_by_college_id: string | null = scope.collegeId;
    const created_by_admin_id: string | null = scope.admin ? user.id : null;
    const created_by_startup_id: string | null = null;
    const source_based_on_role = scope.admin ? 'admin' : 'college';

    const createdTasks: any[] = [];
    const skippedStudents: string[] = [];
    const assignments: any[] = [];
    const currentTime = new Date().toISOString();

    // Generates a task via the shared helper (DeepSeek -> Gemini -> Kimi).
    // json: false — the reply is parsed as "Title:/Description:" prose.
    async function generateWithGemini(prompt: string, model = 'shared'): Promise<{ title: string; description: string; model: string }> {
      console.log('Generating task, prompt length:', prompt.length);

      let text = '';
      try {
        const result = await generateText(prompt, { maxOutputTokens: 1000, json: false }, { feature: 'assign_tasks' });
        text = result.text;
        model = result.provider;
      } catch (llmError) {
        console.error('All LLM providers failed:', llmError);
        throw new Error('AI generation failed, please retry.');
      }

      if (!text) {
        console.error('No text content in response');
        throw new Error('AI generation failed, please retry.');
      }

      console.log(`Generated text via ${model}`);

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
      const approvedByAdmin = scope.admin; // only an admin's task is pre-approved (migration 103 clamp)
      
      // Determine the correct source based on role if not provided
      const finalSource = taskData.source || source_based_on_role;
      
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          title: taskData.title,
          description: taskData.description,
          due_date: due_date,
          status: 'Pending', // Will be overridden by trigger based on verification
          xp_reward: scope.admin ? (taskData.xp_reward || 0) : 0,
          created_at: currentTime,
          updated_at: currentTime,
          duration_days: 7,
          created_by_college_id,
          created_by_admin_id,
          created_by_startup_id,
          is_paid: false,
          required_skills: [],
          posted_at: currentTime,
          category: taskData.category ?? category,
          visibility,
          approved_by_admin: approvedByAdmin,
          source: finalSource,
          ai_metadata: taskData.ai_metadata || null,
          sandbox_config_id: taskData.sandbox_config_id ?? null,
          rubric_config_id: taskData.rubric_config_id ?? null,
          // Declared type; the database refuses a coding task with no tests.
          ...(taskData.grading_type ? { grading_type: taskData.grading_type } : {})
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

    // Every task created here gets a live, auto-graded config attached
    // before it's ever shown to a student — there is no upload fallback.
    // 'Coding' category gets a sandbox (code-runner) config; everything else
    // (Design/Research/Writing/Analysis/General) gets a rubric config.
    // generateGradedConfig() can downgrade a coding request to a checklist when it
    // cannot build tests that pass its quality gate. That is fine for written
    // categories; for Coding it is refused below.
    async function attachGradingConfig(title: string, description: string) {
      const gradingMode: AutoConfigMode = category === 'Coding' ? 'sandbox' : 'rubric';
      const result = await generateGradedConfig({
        db: supabase,
        mode: gradingMode,
        content: { kind: 'fixed', title, description },
        feature: 'assign_tasks',
        usageCtx: { userId: callerId },
        createdBy: callerId,
        // A Coding task fails cleanly instead of first building a written fallback it would refuse.
        explicitSandbox: gradingMode === 'sandbox',
      });
      // A Coding task is graded by real tests or it is not created (migration 74):
      // it must never quietly become a written task marked against a checklist.
      if (explicitCodingProblem(gradingMode === 'sandbox', result)) {
        throw new Error('Could not build working tests for this coding task. Reword the task or choose another category.');
      }
      return {
        sandbox_config_id: result.mode === 'sandbox' ? result.configId : null,
        rubric_config_id: result.mode === 'rubric' ? result.configId : null,
        grading_type: gradingMode === 'sandbox' ? 'coding' : 'written',
      };
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

        const gradingConfig = await attachGradingConfig(trimmedTitle, trimmedDescription);
        const task = await insertTask({
          title: trimmedTitle,
          description: trimmedDescription,
          xp_reward,
          source: 'manual',
          ...gradingConfig
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
        if (!(await templateAllowed(supabase, scope, callerId, template.created_by ?? null))) {
          throw new Error('Insufficient permissions');
        }

        const gradingConfig = await attachGradingConfig(template.title, template.description);
        const task = await insertTask({
          title: template.title,
          description: template.description,
          xp_reward: template.xp_reward || xp_reward,
          source: 'template',
          ...gradingConfig
        });

        createdTasks.push(task);
        
        if (selected_students.length > 0) {
          const taskAssignments = await insertAssignments(task.id, selected_students);
          assignments.push(...taskAssignments);
        }
        break;
      }

      case 'personalized': {
        // Owner 12 Nov 2026: reuse a saved personal task first; AI writes a new one only when nothing fits and the
        // creator made fewer than PERSONAL_AI_PER_WEEK this week. A student never gets the same task twice.
        // preview: true answers the plan per student and writes nothing (no AI either).
        if (selected_students.length === 0) {
          throw new Error('At least one student must be selected for personalized mode');
        }
        const students = await getStudentProfiles(selected_students);
        if (students.length === 0) {
          throw new Error('No student profiles found. Students need to complete their profiles first.');
        }
        const preview = requestData.preview === true;

        // ponytail: newest 2000 personal tasks scanned in memory; move matching into SQL past that.
        const { data: poolRows, error: poolErr } = await supabase.from('tasks')
          .select('id, title, description, category, grading_type, rubric_config_id, sandbox_config_id, ai_metadata, created_at, created_by_college_id, created_by_admin_id')
          .eq('source', 'personalized').order('created_at', { ascending: false }).limit(2000);
        if (poolErr) throw poolErr;
        const pool: any[] = poolRows ?? [];
        const originOf = (t: any) => (t.ai_metadata?.reused_from as string) || t.id;
        const originals = pool.filter((t: any) => !t.ai_metadata?.reused_from);
        const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
        let newThisWeek = originals.filter((t: any) => Date.parse(t.created_at) > weekAgo
          && (scope.admin ? t.created_by_admin_id === user.id : t.created_by_college_id === created_by_college_id)).length;

        const plan: any[] = [];
        for (const student of students) {
          const { data: mine, error: mineErr } = await supabase.from('task_assignments').select('task_id').eq('student_id', student.id);
          if (mineErr) throw mineErr;
          const mineIds = new Set((mine ?? []).map((r: any) => r.task_id));
          const had = new Set(pool.filter((t: any) => mineIds.has(t.id)).map(originOf));
          const best = originals.filter((t: any) => !had.has(t.id))
            .map((t: any) => ({ t, score: personalMatch(student, t.ai_metadata?.student_profile) }))
            .sort((x, y) => y.score - x.score)[0];
          let step: any;
          if (best && best.score >= 2) step = { kind: 'saved', task: best.t };
          else if (newThisWeek < PERSONAL_AI_PER_WEEK) { newThisWeek++; step = { kind: 'new' }; }
          else if (best) step = { kind: 'saved', task: best.t };
          else step = { kind: 'none' };
          plan.push({ studentId: student.id, studentName: student.full_name, ...step });
          if (preview) {
            // a preview "new" stands in for a task the next similar student would reuse
            if (step.kind === 'new') originals.unshift({ id: `new-${student.id}`, title: `same as the new task for ${student.full_name}`, description: '', ai_metadata: { student_profile: student }, created_at: currentTime });
            continue;
          }

          if (step.kind === 'saved') {
            const t = step.task;
            const task = await insertTask({
              title: t.title, description: t.description, xp_reward, source: 'personalized', category: t.category,
              ai_metadata: { reused_from: t.id, for_student: student.id, reused_at: currentTime },
              rubric_config_id: t.rubric_config_id, sandbox_config_id: t.sandbox_config_id, grading_type: t.grading_type,
            });
            pool.unshift(task);
            createdTasks.push(task);
            assignments.push(...await insertAssignments(task.id, [student.id]));
          } else if (step.kind === 'new') {
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

            let gen: { title: string; description: string; model: string };
            try {
              gen = await generateWithGemini(prompt, 'gemini-flash-latest');
            } catch (error) {
              console.error('personal task generation failed', error);
              throw new Error(`AI generation failed for ${student.full_name}, please retry.`);
            }
            const gradingConfig = await attachGradingConfig(gen.title, gen.description);
            const task = await insertTask({
              title: gen.title, description: gen.description, xp_reward, source: 'personalized',
              ai_metadata: {
                model: gen.model, for_student: student.id, generated_at: currentTime, prompt_type: 'personalized_mini_project',
                student_profile: {
                  full_name: student.full_name, branch: student.branch, year_of_study: student.year_of_study,
                  key_interests: student.key_interests, preferred_skills: student.preferred_skills, career_goals: student.career_goals,
                },
              },
              ...gradingConfig,
            });
            originals.unshift(task);   // the next similar student in this same request reuses it
            pool.unshift(task);
            createdTasks.push(task);
            assignments.push(...await insertAssignments(task.id, [student.id]));
          }
        }

        const skipped = plan.filter((p) => p.kind === 'none').map((p) => p.studentName);
        if (preview) {
          return new Response(JSON.stringify({
            success: true,
            plan: plan.map((p) => ({ studentId: p.studentId, studentName: p.studentName, kind: p.kind,
              title: p.task?.title ?? null, description: p.task?.description ?? null })),
            new_left_this_week: Math.max(0, PERSONAL_AI_PER_WEEK - newThisWeek),
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (createdTasks.length === 0) {
          throw new Error(`No new personal task left for ${skipped.join(', ')}. Write one in the Manual tab.`);
        }
        skippedStudents.push(...skipped);
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
      task_assignments: assignments,
      skipped_students: skippedStudents
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
      // S41: was case-sensitive, so 'Invalid authentication' (a bad, forged or expired ticket) answered 500.
      if (/authenticat|authoriz/i.test(errorMessage)) {
        statusCode = 401;
        errorMessage = 'Authentication failed. Please log in again.';
      } else if (errorMessage.includes('Insufficient permissions')) {
        statusCode = 403;
        errorMessage = 'You do not have permission to perform this action.';
      } else if (errorMessage.includes('required')) {
        statusCode = 400;
        errorMessage = 'Missing required fields: ' + errorMessage;
      } else if (/Could not build working tests|No new personal task left/.test(errorMessage)) {
        statusCode = 422;   // the author can act on it: reword, or write one by hand
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