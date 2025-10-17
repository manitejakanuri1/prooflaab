import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const VIEWED_NOTIFICATIONS_KEY = 'college_viewed_notifications';

export const useCollegeNotifications = () => {
  const { data: unreadCount = 0, isLoading, refetch } = useQuery({
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

      // Get viewed notifications from localStorage
      const viewedNotifications = JSON.parse(
        localStorage.getItem(VIEWED_NOTIFICATIONS_KEY) || '[]'
      ) as string[];

      // Count pending proof submissions
      const { data: students } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('college_id', collegeData.id);

      if (!students || students.length === 0) return 0;

      const studentIds = students.map(s => s.id);

      // Get all pending proofs
      const { data: proofs } = await supabase
        .from('proof_uploads')
        .select('id')
        .in('student_id', studentIds)
        .eq('status', 'Under Review');

      if (!proofs) return 0;

      // Count unviewed proofs
      const unviewedCount = proofs.filter(
        proof => !viewedNotifications.includes(`proof-${proof.id}`)
      ).length;

      return unviewedCount;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const markAsViewed = (notificationIds: string[]) => {
    const viewed = JSON.parse(
      localStorage.getItem(VIEWED_NOTIFICATIONS_KEY) || '[]'
    ) as string[];
    
    const updated = [...new Set([...viewed, ...notificationIds])];
    localStorage.setItem(VIEWED_NOTIFICATIONS_KEY, JSON.stringify(updated));
    refetch();
  };

  const markAllAsViewed = () => {
    // This will be called from the notifications page
    refetch();
  };

  return {
    unreadCount,
    isLoading,
    markAsViewed,
    markAllAsViewed,
    refetch
  };
};
