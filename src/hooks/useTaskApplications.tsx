import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface TaskApplication {
  id: string;
  task_id: string;
  student_id: string;
  application_note: string | null;
  portfolio_link: string | null;
  status: 'Pending Review' | 'Accepted' | 'Rejected';
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  tasks?: {
    title: string;
    description: string;
    xp_reward: number;
    category: string;
    created_by_startup_id: string;
  };
  student_profiles?: {
    full_name: string;
    email: string;
    profile_photo_url: string | null;
  };
}

interface ApplicationData {
  taskId: string;
  applicationNote: string;
  portfolioLink?: string;
}

// Hook for students to view their applications
export const useStudentApplications = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['student-applications', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return [];

      const { data, error } = await supabase
        .from('task_applications')
        .select(`
          *,
          tasks:task_id (
            title,
            description,
            xp_reward,
            category,
            created_by_startup_id
          )
        `)
        .eq('student_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
};

// Hook for startups to view applications for their tasks
export const useStartupApplications = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['startup-applications', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from('task_applications')
        .select(`
          *,
          tasks:task_id (
            title,
            description,
            xp_reward,
            category,
            created_by_startup_id
          ),
          student_profiles:student_id (
            full_name,
            email,
            profile_photo_url
          )
        `)
        .eq('tasks.created_by_startup_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
};

// Hook for students to apply to tasks
export const useApplyToTask = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, applicationNote, portfolioLink }: ApplicationData) => {
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) throw new Error('Student profile not found');

      const { data, error } = await supabase
        .from('task_applications')
        .insert({
          task_id: taskId,
          student_id: profile.id,
          application_note: applicationNote,
          portfolio_link: portfolioLink || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Application submitted successfully!');
      queryClient.invalidateQueries({ queryKey: ['student-applications'] });
      queryClient.invalidateQueries({ queryKey: ['available-tasks'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to submit application');
    },
  });
};

// Hook for startups to review applications
export const useReviewApplication = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      applicationId, 
      status, 
      rejectionReason 
    }: { 
      applicationId: string; 
      status: 'Accepted' | 'Rejected'; 
      rejectionReason?: string;
    }) => {
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('task_applications')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
          rejection_reason: rejectionReason || null,
        })
        .eq('id', applicationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Application ${data.status.toLowerCase()} successfully!`);
      queryClient.invalidateQueries({ queryKey: ['startup-applications'] });
      queryClient.invalidateQueries({ queryKey: ['startup-tasks'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to review application');
    },
  });
};

export type { TaskApplication };