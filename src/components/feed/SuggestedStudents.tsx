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
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4" />
          Suggested Students
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4 space-y-3">
              <Skeleton className="h-12 w-12 rounded-full mx-auto" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4 mx-auto" />
              <Skeleton className="h-8 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4" />
          Suggested Students
        </h3>
        <Card className="p-6 text-center">
          <User className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No suggestions available yet.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Users className="h-4 w-4" />
        Suggested Students
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        {recommendations.slice(0, 8).map((student) => {
          const isFollowing = followingStates[student.student_id] || false;
          
          return (
            <Card 
              key={student.student_id}
              className="p-4 hover:shadow-md transition-all duration-200 bg-card/50 backdrop-blur-sm border-border/50 rounded-xl"
              style={{ width: '100%', minWidth: '160px', maxWidth: '190px' }}
            >
              <div className="flex flex-col items-center space-y-3">
                {/* Avatar */}
                <Avatar className="h-12 w-12 border-2 border-border">
                  <AvatarImage src={student.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-sm">
                    {getInitials(student.full_name)}
                  </AvatarFallback>
                </Avatar>

                {/* Name */}
                <div className="text-center w-full">
                  <h4 className="text-sm font-semibold text-foreground truncate">
                    {student.full_name}
                  </h4>
                  {student.bio && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {student.bio}
                    </p>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground w-full justify-center">
                  <div className="flex items-center gap-1" title="Total XP">
                    <Award className="h-3 w-3 text-orange-500" />
                    <span className="font-medium">{student.total_xp}</span>
                  </div>
                  <div className="flex items-center gap-1" title="Trust Score">
                    <div className="h-3 w-3 rounded-full bg-green-500 flex items-center justify-center text-[8px] text-white font-bold">
                      T
                    </div>
                    <span className="font-medium">{student.trust_score}</span>
                  </div>
                </div>

                {/* Follow Button */}
                <Button
                  size="sm"
                  variant={isFollowing ? "outline" : "default"}
                  className="w-full text-xs h-7"
                  onClick={() => handleFollowToggle(student)}
                  disabled={followMutation.isPending || unfollowMutation.isPending}
                >
                  {isFollowing ? "Following ✓" : "Follow"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Next: integrate this into Feed sidebar */}
    </div>
  );
};

export default SuggestedStudents;
