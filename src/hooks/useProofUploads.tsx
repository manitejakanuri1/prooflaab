
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { startOfMonth, endOfMonth } from "date-fns";

export interface ProofUpload {
  id: string;
  task_id: string;
  student_id: string;
  file_url: string | null;
  // Uploaded proofs live in a private bucket; file_path is where, file_url is a
  // link the student pasted. They are never both set.
  file_path: string | null;
  file_name: string | null;
  submission_notes: string | null;
  status: 'Under Review' | 'Verified' | 'Rejected';
  submitted_at: string;
  is_public: boolean;
  tasks?: {
    title: string;
    xp_reward?: number;
    xp?: number;
  };
}

export const useProofUploads = (currentDate: Date) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['proof-uploads', user?.id, currentDate.getMonth(), currentDate.getFullYear()],
    queryFn: async () => {
      if (!user) return [];

      // Get student profile ID first
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return [];

      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);

      const { data, error } = await supabase
        .from('proof_uploads')
        .select(`
          *,
          tasks:task_id (
            title,
            xp_reward,
            xp
          )
        `)
        .eq('student_id', profile.id)
        .gte('submitted_at', monthStart.toISOString())
        .lte('submitted_at', monthEnd.toISOString())
        .order('submitted_at', { ascending: false });

      if (error) {
        console.error('Error fetching proof uploads:', error);
        throw error;
      }

      return data || [];
    },
    enabled: !!user,
  });
};
