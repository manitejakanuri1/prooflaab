import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";
import { getInitials } from "@/lib/utils";

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

interface OnboardingFollowSuggestionsProps {
  open: boolean;
  onComplete: () => void;
}

const OnboardingFollowSuggestions = ({ open, onComplete }: OnboardingFollowSuggestionsProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [followingStates, setFollowingStates] = useState<Record<string, boolean>>({});
  const [followedCount, setFollowedCount] = useState(0);

  // Fetch recommended students
  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['follow-recommendations-onboarding'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_follow_recommendations');
      
      if (error) {
        console.error('Error fetching recommendations:', error);
        throw error;
      }

      return (data || []) as SuggestedStudent[];
    },
    enabled: open,
  });

  // Update followed count whenever followingStates changes
  useEffect(() => {
    const count = Object.values(followingStates).filter(Boolean).length;
    setFollowedCount(count);
  }, [followingStates]);

  // Follow mutation
  const followMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.rpc('follow_user', { target_id: targetUserId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follow-recommendations-onboarding'] });
    },
    onError: (_, targetUserId) => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follow-recommendations-onboarding'] });
    },
    onError: (_, targetUserId) => {
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

  const handleContinue = () => {
    localStorage.setItem('follow_onboarding_completed', 'true');
    onComplete();
    toast({
      title: "Welcome to ProofLab!",
      description: "Your feed is now personalized with your followed students.",
    });
  };


  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Follow students to personalize your feed
          </DialogTitle>
          <DialogDescription className="text-base">
            Select at least 3 students to get started
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 py-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex flex-col items-center gap-3 p-4 border rounded-lg">
                <Skeleton className="h-20 w-20 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 py-6">
              {recommendations.slice(0, 12).map((student) => {
                const isFollowing = followingStates[student.student_id] || false;
                
                return (
                  <div 
                    key={student.student_id}
                    className="relative flex flex-col items-center gap-3 p-4 border border-border rounded-lg hover:border-primary/50 transition-colors"
                  >
                    {/* Checkmark overlay for followed students */}
                    {isFollowing && (
                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                        <Check className="h-4 w-4" />
                      </div>
                    )}

                    {/* Avatar */}
                    <Avatar className="h-20 w-20 border-2 border-border">
                      <AvatarImage src={student.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-lg">
                        {getInitials(student.full_name)}
                      </AvatarFallback>
                    </Avatar>

                    {/* Name */}
                    <div className="text-center">
                      <h4 className="text-sm font-semibold text-foreground truncate max-w-[150px]">
                        {student.full_name}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {student.total_xp} XP
                      </p>
                    </div>

                    {/* Follow Button */}
                    <Button
                      size="sm"
                      variant={isFollowing ? "outline" : "default"}
                      className="w-full h-8 text-xs font-semibold rounded-full"
                      onClick={() => handleFollowToggle(student)}
                      disabled={followMutation.isPending || unfollowMutation.isPending}
                    >
                      {isFollowing ? "Following ✓" : "Follow"}
                    </Button>
                  </div>
                );
              })}
            </div>

            {/* Sticky Footer */}
            <div className="sticky bottom-0 bg-background border-t pt-4 pb-2 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {followedCount < 3 ? (
                  <>Follow at least {3 - followedCount} more student{3 - followedCount !== 1 ? 's' : ''}</>
                ) : (
                  <>Great! You've followed {followedCount} students</>
                )}
              </p>
              <Button
                onClick={handleContinue}
                disabled={followedCount < 3}
                size="lg"
                className="px-8"
              >
                Continue
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

// Step 7E complete — Follow Onboarding Modal implemented

export default OnboardingFollowSuggestions;
