import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subDays } from "date-fns";

export interface AdminDashboardStats {
  totalSubmissions: number;
  verifiedSubmissions: number;
  rejectedSubmissions: number;
  pendingReviews: number;
  mossSubmissions: number;
  averageMossScore: number;
  activeStudentsThisWeek: number;
  topCollege: string;
}

export interface RecentSubmission {
  student_email: string;
  task_title: string;
  submitted_at: string;
  status: string;
}

export const useAdminDashboardStats = () => {
  return useQuery({
    queryKey: ['admin-dashboard-stats'],
    queryFn: async (): Promise<AdminDashboardStats> => {
      // Get all proof uploads for statistics
      const { data: proofs, error: proofsError } = await supabase
        .from('proof_uploads')
        .select(`
          *,
          tasks (title),
          student_profiles:student_id (email, batch)
        `);

      if (proofsError) throw proofsError;

      // Calculate basic stats
      const totalSubmissions = proofs?.length || 0;
      const verifiedSubmissions = proofs?.filter(p => p.status === 'Verified').length || 0;
      const rejectedSubmissions = proofs?.filter(p => p.status === 'Rejected').length || 0;
      const pendingReviews = proofs?.filter(p => p.status === 'Under Review').length || 0;

      // MOSS statistics
      const mossSubmissions = proofs?.filter(p => 
        p.moss_score !== null && 
        p.moss_status !== 'Error'
      ).length || 0;

      const validMossScores = proofs?.filter(p => 
        p.moss_score !== null && 
        typeof p.moss_score === 'number' && 
        !isNaN(p.moss_score)
      ).map(p => p.moss_score as number) || [];

      const averageMossScore = validMossScores.length > 0 
        ? Math.round(validMossScores.reduce((sum, score) => sum + score, 0) / validMossScores.length)
        : 0;

      // Active students this week (last 7 days)
      const weekAgo = subDays(new Date(), 7);
      const activeStudentsThisWeek = proofs?.filter(p => 
        new Date(p.submitted_at || '') >= weekAgo
      ).reduce((uniqueStudents, proof) => {
        const studentId = proof.student_id;
        if (!uniqueStudents.includes(studentId)) {
          uniqueStudents.push(studentId);
        }
        return uniqueStudents;
      }, [] as string[]).length || 0;

      // Top college (most submissions)
      const collegeSubmissions = proofs?.reduce((acc, proof) => {
        const college = (proof.student_profiles as any)?.batch || 'Unknown';
        acc[college] = (acc[college] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      const topCollege = Object.entries(collegeSubmissions)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || 'No Data';

      return {
        totalSubmissions,
        verifiedSubmissions,
        rejectedSubmissions,
        pendingReviews,
        mossSubmissions,
        averageMossScore,
        activeStudentsThisWeek,
        topCollege
      };
    },
  });
};

export const useRecentSubmissions = () => {
  return useQuery({
    queryKey: ['recent-submissions'],
    queryFn: async (): Promise<RecentSubmission[]> => {
      const { data, error } = await supabase
        .from('proof_uploads')
        .select(`
          submitted_at,
          status,
          tasks!inner (title),
          student_profiles:student_id!inner (email)
        `)
        .order('submitted_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      return data?.map(item => ({
        student_email: (item.student_profiles as any)?.email || 'Unknown',
        task_title: (item.tasks as any)?.title || 'Unknown Task',
        submitted_at: item.submitted_at || '',
        status: item.status || 'Unknown'
      })) || [];
    },
  });
};

export const usePendingReviewsCount = () => {
  return useQuery({
    queryKey: ['pending-reviews-48h'],
    queryFn: async (): Promise<number> => {
      const twoDaysAgo = subDays(new Date(), 2);
      
      const { data, error } = await supabase
        .from('proof_uploads')
        .select('id')
        .eq('status', 'Under Review')
        .lt('submitted_at', twoDaysAgo.toISOString());

      if (error) throw error;

      return data?.length || 0;
    },
  });
};