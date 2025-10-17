import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useCollegeNotifications = () => {
  const { data: unreadCount = 0, isLoading } = useQuery({
    queryKey: ['college-notifications-count'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;

      // Get college ID
      const { data: collegeData } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!collegeData) return 0;

      // Count pending proof submissions
      const { data: students } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('college_id', collegeData.id);

      if (!students || students.length === 0) return 0;

      const studentIds = students.map(s => s.id);

      // Count pending proofs
      const { count: proofsCount } = await supabase
        .from('proof_uploads')
        .select('*', { count: 'exact', head: true })
        .in('student_id', studentIds)
        .eq('status', 'Under Review');

      return proofsCount || 0;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  return {
    unreadCount,
    isLoading
  };
};
