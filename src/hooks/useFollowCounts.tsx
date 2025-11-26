import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useFollowCounts = (userId?: string) => {
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const fetchCounts = async () => {
      try {
        // Get follower count
        const { data: followerData, error: followerError } = await supabase.rpc(
          'get_follower_count',
          { user_id: userId }
        );

        if (followerError) throw followerError;
        setFollowerCount(followerData || 0);

        // Get following count
        const { data: followingData, error: followingError } = await supabase.rpc(
          'get_following_count',
          { user_id: userId }
        );

        if (followingError) throw followingError;
        setFollowingCount(followingData || 0);
      } catch (error) {
        console.error('Error fetching follow counts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCounts();
  }, [userId]);

  return { followerCount, followingCount, loading, setFollowerCount, setFollowingCount };
};
