
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useCreateTask = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const createTask = async (taskData: {
    title: string;
    description: string;
    due_date: string;
    status: string;
    xp_reward: number;
    xp: number;
  }) => {
    setLoading(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error("No authenticated user");
      }

      // Get student profile to get student_id
      const { data: profile, error: profileError } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (profileError) {
        throw new Error(profileError.message);
      }

      console.log('Creating task for student:', profile.id);

      // Insert the task
      const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert([
          {
            student_id: profile.id,
            title: taskData.title,
            description: taskData.description,
            due_date: taskData.due_date,
            status: taskData.status,
            xp_reward: taskData.xp_reward,
            xp: taskData.xp,
            created_at: new Date().toISOString(),
            completed_at: null
          }
        ])
        .select()
        .single();

      if (taskError) {
        throw new Error(taskError.message);
      }

      console.log('Task created successfully:', newTask);

      toast({
        title: "Task Created",
        description: `Task "${taskData.title}" has been assigned successfully!`,
      });

      return newTask;

    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        title: "Error Creating Task",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return { createTask, loading };
};
