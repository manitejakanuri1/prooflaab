import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface AvailableTask {
  id: string;
  title: string;
  description: string | null;
  xp_reward: number | null;
  category: string | null;
  visibility: string | null;
  due_date: string;
  is_paid: boolean | null;
  required_skills: string[] | null;
  created_at: string | null;
  created_by_startup_id: string | null;
  status: string | null;
  duration_days: number | null;
  student_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  posted_at: string | null;
  upload_deadline: string | null;
  xp: number | null;
  has_applied?: boolean;
  application_status?: 'Pending Review' | 'Accepted' | 'Rejected';
}

export const useAvailableTasks = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['available-tasks', user?.id],
    staleTime: 60000, // Cache for 60 seconds
    gcTime: 300000, // Keep in cache for 5 minutes
    queryFn: async () => {
      console.log('useAvailableTasks called with user:', user?.id);
      
      if (!user?.id) {
        console.log('No user ID available');
        return [];
      }

      // Get student profile ID
      const { data: profile, error: profileError } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      console.log('Student profile lookup:', { profile, profileError, userId: user.id });

      if (profileError) {
        console.error('Error fetching student profile:', profileError);
        throw profileError;
      }

      if (!profile) {
        console.log('No student profile found for user:', user.id);
        return [];
      }

      // Get task_assignments for this student to exclude already assigned tasks
      const { data: assignments, error: assignmentsError } = await supabase
        .from('task_assignments')
        .select('task_id')
        .eq('student_id', profile.id);

      if (assignmentsError) throw assignmentsError;

      const assignedTaskIds = assignments?.map(a => a.task_id) || [];

      // Get available tasks (public visibility, approved by admin, not assigned to anyone, not expired)
      let query = supabase
        .from('tasks')
        .select('*')
        .eq('visibility', 'public')
        .eq('approved_by_admin', true)
        .is('student_id', null)
        .gte('due_date', new Date().toISOString())
        .order('posted_at', { ascending: false });

      // Only filter out assigned tasks if there are any
      if (assignedTaskIds.length > 0) {
        query = query.not('id', 'in', `(${assignedTaskIds.join(',')})`);
      }

      const { data: tasks, error: tasksError } = await query;

      if (tasksError) throw tasksError;

      if (!tasks || tasks.length === 0) return [];

      // Get applications for this student to check if they've already applied
      const { data: applications, error: applicationsError } = await supabase
        .from('task_applications')
        .select('task_id, status')
        .eq('student_id', profile.id)
        .in('task_id', tasks.map(task => task.id));

      if (applicationsError) throw applicationsError;

      // Create a map of task applications
      const applicationMap = new Map();
      applications?.forEach(app => {
        applicationMap.set(app.task_id, app.status);
      });

      // Merge application status with tasks
      const tasksWithApplicationStatus = tasks.map(task => ({
        ...task,
        has_applied: applicationMap.has(task.id),
        application_status: applicationMap.get(task.id),
      }));

      return tasksWithApplicationStatus;
    },
    enabled: !!user,
  });
};

export type { AvailableTask };