import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface SuggestedStudent {
  student_id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  total_xp: number;
  trust_score: number;
  slug: string | null;
  branch: string | null;
  skills: string[] | null;
}

interface PublicSuggestedStudentsProps {
  currentStudentId: string;
  currentBranch?: string | null;
  currentSkills?: string[];
}

const PublicSuggestedStudents = ({ 
  currentStudentId, 
  currentBranch,
  currentSkills = []
}: PublicSuggestedStudentsProps) => {
  const navigate = useNavigate();

  // Fetch similar students
  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['public-similar-students', currentStudentId, currentBranch],
    queryFn: async () => {
      // Query for students with similar attributes
      let query = supabase
        .from('student_profiles')
        .select(`
          id,
          full_name,
          profile_photo_url,
          total_xp,
          trust_score,
          slug,
          branch,
          career_goals
        `)
        .neq('id', currentStudentId) // Exclude current student
        .eq('profile_visibility', 'public')
        .eq('status', 'active')
        .order('total_xp', { ascending: false });

      // Prioritize same branch if available
      if (currentBranch) {
        query = query.eq('branch', currentBranch);
      }

      const { data, error } = await query.limit(5);
      
      if (error) {
        console.error('Error fetching similar students:', error);
        // Fallback: fetch random students if filtering fails
        const { data: fallbackData } = await supabase
          .from('student_profiles')
          .select(`
            id,
            full_name,
            profile_photo_url,
            total_xp,
            trust_score,
            slug,
            branch,
            career_goals
          `)
          .neq('id', currentStudentId)
          .eq('profile_visibility', 'public')
          .eq('status', 'active')
          .order('total_xp', { ascending: false })
          .limit(5);
        
        return (fallbackData || []).map((student: any) => ({
          student_id: student.id,
          full_name: student.full_name,
          avatar_url: student.profile_photo_url,
          bio: student.career_goals,
          total_xp: student.total_xp || 0,
          trust_score: student.trust_score || 0,
          slug: student.slug,
          branch: student.branch,
          skills: null
        })) as SuggestedStudent[];
      }

      return (data || []).map((student: any) => ({
        student_id: student.id,
        full_name: student.full_name,
        avatar_url: student.profile_photo_url,
        bio: student.career_goals,
        total_xp: student.total_xp || 0,
        trust_score: student.trust_score || 0,
        slug: student.slug,
        branch: student.branch,
        skills: null
      })) as SuggestedStudent[];
    },
  });

  const handleViewProfile = (student: SuggestedStudent) => {
    const slug = student.slug || student.student_id;
    navigate(`/portfolio/${slug}`);
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
        <h3 className="text-base font-semibold text-foreground mb-1">
          Similar Students
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Discover students with related skills and achievements
        </p>
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
        <h3 className="text-base font-semibold text-foreground mb-1">
          Similar Students
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Discover students with related skills and achievements
        </p>
        <div className="text-center py-6">
          <User className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No similar students found.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 rounded-xl border-border/50 bg-card shadow-sm">
      <h3 className="text-base font-semibold text-foreground mb-1">
        Similar Students
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Discover students with related skills and achievements
      </p>
      
      <div className="space-y-4">
        {recommendations.map((student) => {
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
                    {student.branch && ` • ${student.branch}`}
                  </p>
                </div>

                {/* View Profile Button */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-4 text-xs font-semibold rounded-full"
                  onClick={() => handleViewProfile(student)}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View Profile
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 7D complete — SuggestedStudents added to Public Portfolio Viewer */}
    </Card>
  );
};

export default PublicSuggestedStudents;
