import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Award, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SuggestedStudent {
  student_id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  total_xp: number;
  trust_score: number;
  followers_count: number;
  rank_score: number;
}

const SuggestedStudents = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [followingStates, setFollowingStates] = useState<Record<string, boolean>>({});

  // Fetch recommended students
  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['follow-recommendations'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_follow_recommendations');
      
      if (error) {
        console.error('Error fetching recommendations:', error);
        throw error;
      }

      return (data || []) as SuggestedStudent[];
    },
  });

  // Follow mutation
  const followMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.rpc('follow_user', { target_id: targetUserId });
      if (error) throw error;
    },
    onSuccess: (_, targetUserId) => {
      queryClient.invalidateQueries({ queryKey: ['follow-recommendations'] });
      toast({
        title: "Following",
        description: "You are now following this student.",
      });
    },
    onError: (_, targetUserId) => {
      // Revert optimistic update
      setFollowingStates(prev => ({ ...prev, [targetUserId]: false }));
      toast({
        title: "Error",
        description: "Failed to follow student. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Unfollow mutation
  const unfollowMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.rpc('unfollow_user', { target_id: targetUserId });
      if (error) throw error;
    },
    onSuccess: (_, targetUserId) => {
      queryClient.invalidateQueries({ queryKey: ['follow-recommendations'] });
      toast({
        title: "Unfollowed",
        description: "You have unfollowed this student.",
      });
    },
    onError: (_, targetUserId) => {
      // Revert optimistic update
      setFollowingStates(prev => ({ ...prev, [targetUserId]: true }));
      toast({
        title: "Error",
        description: "Failed to unfollow student. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleFollowToggle = (student: SuggestedStudent) => {
    const isCurrentlyFollowing = followingStates[student.student_id] || false;
    
    // Optimistic update
    setFollowingStates(prev => ({ 
      ...prev, 
      [student.student_id]: !isCurrentlyFollowing 
    }));

    if (isCurrentlyFollowing) {
      unfollowMutation.mutate(student.student_id);
    } else {
      followMutation.mutate(student.student_id);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (isLoading) {
    return (
      <Card className="p-5 rounded-xl border-border/50 bg-card shadow-sm">
        <h3 className="text-base font-semibold text-foreground mb-4">
          People you may know
        </h3>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-8 w-24 mt-2" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (recommendations.length === 0) {
    return (
      <Card className="p-5 rounded-xl border-border/50 bg-card shadow-sm">
        <h3 className="text-base font-semibold text-foreground mb-4">
          People you may know
        </h3>
        <div className="text-center py-6">
          <User className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No suggestions available yet.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 rounded-xl border-border/50 bg-card shadow-sm">
      <h3 className="text-base font-semibold text-foreground mb-4">
        People you may know
      </h3>
      
      <div className="space-y-4">
        {recommendations.slice(0, 8).map((student) => {
          const isFollowing = followingStates[student.student_id] || false;
          
          return (
            <div 
              key={student.student_id}
              className="flex items-start gap-3 pb-4 border-b border-border/30 last:border-0 last:pb-0"
            >
              {/* Avatar */}
              <Avatar className="h-12 w-12 flex-shrink-0 border border-border">
                <AvatarImage src={student.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-sm">
                  {getInitials(student.full_name)}
                </AvatarFallback>
              </Avatar>

              {/* Info and Button */}
              <div className="flex-1 min-w-0">
                {/* Name and Bio */}
                <div className="mb-2">
                  <h4 className="text-sm font-semibold text-foreground truncate">
                    {student.full_name}
                  </h4>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {student.bio || `${student.total_xp} XP • Trust Score ${student.trust_score}`}
                  </p>
                </div>

                {/* Follow Button */}
                <Button
                  size="sm"
                  variant={isFollowing ? "outline" : "default"}
                  className="h-8 px-4 text-xs font-semibold rounded-full"
                  onClick={() => handleFollowToggle(student)}
                  disabled={followMutation.isPending || unfollowMutation.isPending}
                >
                  {isFollowing ? "Following ✓" : "Follow"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Next: integrate this into Feed sidebar */}
    </Card>
  );
};

export default SuggestedStudents;
