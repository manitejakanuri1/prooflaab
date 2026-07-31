import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface FollowButtonProps {
  targetUserId: string;
  currentUserId?: string;
  size?: "sm" | "default" | "lg";
  variant?: "feed" | "profile";
  onFollowChange?: (isFollowing: boolean) => void;
}

export const FollowButton = ({
  targetUserId,
  currentUserId,
  size = "sm",
  variant = "feed",
  onFollowChange,
}: FollowButtonProps) => {
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Hide button if user is viewing their own content
  const isOwner = targetUserId === currentUserId;

  useEffect(() => {
    if (!currentUserId || isOwner) {
      setLoading(false);
      return;
    }
    
    fetchFollowState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUserId, currentUserId, isOwner]);

  const fetchFollowState = async () => {
    try {
      // Check if current user is following target user
      const { data: followingData, error: followingError } = await supabase.rpc(
        'is_following',
        { target_id: targetUserId }
      );

      if (followingError) throw followingError;
      setIsFollowing(followingData || false);

      // Get follower count
      const { data: countData, error: countError } = await supabase.rpc(
        'get_follower_count',
        { user_id: targetUserId }
      );

      if (countError) throw countError;
      setFollowerCount(countData || 0);
    } catch (error) {
      console.error('Error fetching follow state:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFollowToggle = async () => {
    if (!currentUserId || isOwner) return;

    const previousFollowing = isFollowing;
    const previousCount = followerCount;

    // Optimistic update
    setIsFollowing(!isFollowing);
    setFollowerCount(prev => isFollowing ? prev - 1 : prev + 1);

    try {
      if (isFollowing) {
        // Unfollow
        const { error } = await supabase.rpc('unfollow_user', {
          target_id: targetUserId,
        });
        if (error) throw error;

        toast({
          title: "Unfollowed",
          description: "You are no longer following this user.",
        });
      } else {
        // Follow
        const { error } = await supabase.rpc('follow_user', {
          target_id: targetUserId,
        });
        if (error) throw error;

        toast({
          title: "Following",
          description: "You are now following this user.",
        });
      }

      // Notify parent component
      onFollowChange?.(!isFollowing);
    } catch (error: any) {
      // Revert optimistic update
      setIsFollowing(previousFollowing);
      setFollowerCount(previousCount);

      toast({
        title: "Error",
        description: error.message || "Failed to update follow status",
        variant: "destructive",
      });
    }
  };

  // Don't render if user is viewing their own content
  if (isOwner || !currentUserId) return null;

  if (loading) {
    return (
      <Button
        size={size}
        variant="ghost"
        disabled
        className={variant === "feed" ? "rounded-full text-xs" : "rounded-xl"}
      >
        <span className="animate-pulse">Loading...</span>
      </Button>
    );
  }

  if (variant === "feed") {
    return (
      <Button
        size="sm"
        onClick={handleFollowToggle}
        className={`rounded-full text-xs font-medium transition-all ${
          isFollowing
            ? "bg-muted text-muted-foreground hover:bg-muted/80"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {isFollowing ? (
          <>
            <Check className="h-3 w-3 mr-1" />
            Following
          </>
        ) : (
          <>
            <UserPlus className="h-3 w-3 mr-1" />
            Follow
          </>
        )}
      </Button>
    );
  }

  // Profile variant
  return (
    <Button
      size={size}
      onClick={handleFollowToggle}
      className={`rounded-xl font-medium transition-all ${
        isFollowing
          ? "bg-muted text-muted-foreground hover:bg-muted/80"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      }`}
    >
      {isFollowing ? (
        <>
          <Check className="h-4 w-4 mr-2" />
          Following
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4 mr-2" />
          Follow
        </>
      )}
      <span className="ml-2 text-xs opacity-75">
        {followerCount} {followerCount === 1 ? 'follower' : 'followers'}
      </span>
    </Button>
  );
};
