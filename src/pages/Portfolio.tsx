import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioProjects } from "@/hooks/usePortfolioProjects";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { PublicProjectCard } from "@/components/portfolio/PublicProjectCard";
import { FollowButton } from "@/components/dashboard/student/FollowButton";
import { FollowersFollowingModal } from "@/components/dashboard/student/FollowersFollowingModal";
import PublicSuggestedStudents from "@/components/feed/PublicSuggestedStudents";
import { useFollowCounts } from "@/hooks/useFollowCounts";
import { supabase } from "@/integrations/supabase/client";
import { 
  Mail, 
  Trophy, 
  XCircle,
  Star,
  Briefcase,
  Users
} from "lucide-react";

const Portfolio = () => {
  const { slug } = useParams<{ slug: string }>();
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const [followModalOpen, setFollowModalOpen] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<"followers" | "following">("followers");
  
  const { portfolio, loading, error } = usePortfolio(slug);
  const { projects, loading: projectsLoading, error: projectsError } = usePortfolioProjects(
    portfolio?.student_id || ""
  );
  const { followerCount, followingCount, loading: countsLoading } = useFollowCounts(portfolio?.student_id);

  // Get current user ID
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Get student profile ID from user_id
        const { data: profile } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();
        setCurrentUserId(profile?.id);
      }
    };
    fetchCurrentUser();
  }, []);

  // Debug logging for API responses
  useEffect(() => {
    console.log('Portfolio API Response:', { portfolio, loading, error });
  }, [portfolio, loading, error]);

  useEffect(() => {
    console.log('Projects API Response:', { projects, loading: projectsLoading, error: projectsError });
  }, [projects, projectsLoading, projectsError]);

  const handleRetry = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading portfolio...</p>
        </div>
      </div>
    );
  }

  if (error || !portfolio) {
    const isInvalidSlug = error === 'Portfolio not found' || !portfolio;
    return (
      <div className="light min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center">
        <Card className="max-w-md mx-auto bg-white border-gray-200">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              {isInvalidSlug ? 'Portfolio Not Found' : 'Something Went Wrong'}
            </h1>
            <p className="text-gray-600 mb-4">
              {isInvalidSlug 
                ? 'This portfolio link is invalid or has been removed.'
                : 'We encountered an error loading this portfolio.'
              }
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={handleRetry}>
                Try Again
              </Button>
              <Button onClick={() => window.location.href = '/'}>
                Go to ProofLabAI
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const trustScore = portfolio?.student_profiles?.trust_score || 0;
  const totalXP = portfolio?.student_profiles?.total_xp || 0;

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const getTrustScoreLabel = (score: number) => {
    if (score >= 80) return 'Highly Trusted';
    if (score >= 60) return 'Trusted';
    return 'Building Trust';
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Generate emoji code from string (for project cards)
  const generateEmojiCode = (str: string) => {
    const emojis = ["1F680", "1F4BB", "1F3A8", "1F4A1", "1F31F", "1F525", "1F389", "1F4DA"];
    const index = (str.charCodeAt(0) + str.length) % emojis.length;
    return emojis[index];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="font-bold text-lg flex items-center space-x-3">
            <Logo />
            <span>ProofLabAI</span>
          </div>
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            Back to Platform
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex gap-8">
          {/* Main Column */}
          <div className="flex-1 min-w-0">
            {/* Hero Section */}
            <div className="relative mb-12 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 rounded-3xl p-8 md:p-12 border border-border shadow-lg">
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Avatar */}
            <Avatar className="h-32 w-32 ring-4 ring-background shadow-xl">
              <AvatarImage
                src={portfolio?.student_profiles?.profile_photo_url || ""}
                alt={portfolio?.student_profiles?.full_name || "Student"}
              />
              <AvatarFallback className="text-4xl font-bold bg-primary/10">
                {getInitials(portfolio?.student_profiles?.full_name || "Student")}
              </AvatarFallback>
            </Avatar>

            {/* Info */}
            <div className="flex-1 text-center md:text-left">
              <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                {portfolio?.student_profiles?.full_name || "Student"}
              </h1>
              <p className="text-muted-foreground text-lg mb-6 max-w-2xl">
                {portfolio?.bio ||
                  "Passionate student building real-world projects through ProofLabAI."}
              </p>

              {/* Skills */}
              {portfolio?.skills && portfolio.skills.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6 justify-center md:justify-start">
                  {portfolio.skills.map((skill, index) => (
                    <Badge key={index} variant="secondary" className="text-sm">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Stats Row */}
              <div className="flex flex-wrap gap-6 justify-center md:justify-start text-sm mb-6">
                <div className="flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-border">
                  <Star className="h-5 w-5 text-yellow-500" />
                  <span className="font-semibold">{totalXP} XP</span>
                </div>
                <div className="flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-border">
                  <Trophy className={`h-5 w-5 ${getTrustScoreColor(trustScore)}`} />
                  <span className={`font-semibold ${getTrustScoreColor(trustScore)}`}>
                    {getTrustScoreLabel(trustScore)} ({trustScore}/100)
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-border">
                  <Briefcase className="h-5 w-5 text-primary" />
                  <span className="font-semibold">{projects.length} Projects</span>
                </div>
                <button
                  onClick={() => {
                    setFollowModalTab("followers");
                    setFollowModalOpen(true);
                  }}
                  className="flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-border hover:bg-background transition-colors cursor-pointer"
                >
                  <Users className="h-5 w-5 text-primary" />
                  <span className="font-semibold">{followerCount} Followers</span>
                </button>
                <button
                  onClick={() => {
                    setFollowModalTab("following");
                    setFollowModalOpen(true);
                  }}
                  className="flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-border hover:bg-background transition-colors cursor-pointer"
                >
                  <Users className="h-5 w-5 text-primary" />
                  <span className="font-semibold">{followingCount} Following</span>
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                <FollowButton
                  targetUserId={portfolio?.student_id || ""}
                  currentUserId={currentUserId}
                  variant="profile"
                  size="default"
                />
                <a
                  href={`mailto:${portfolio?.student_profiles?.email || ""}`}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all shadow-md hover:shadow-lg font-medium"
                >
                  <Mail className="h-4 w-4" />
                  <span>Contact Me</span>
                </a>
              </div>
            </div>
          </div>
            </div>

            {/* Projects Section */}
            <div>
              <div className="flex items-center gap-3 mb-8">
                <Trophy className="h-7 w-7 text-primary" />
                <h2 className="text-3xl font-bold">Projects & Achievements</h2>
              </div>

              {projectsLoading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading projects...</p>
                </div>
              ) : projectsError ? (
                <div className="text-center py-16 bg-card rounded-2xl border border-border">
                  <XCircle className="h-16 w-16 text-destructive/50 mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">Failed to load projects</p>
                  <Button variant="outline" onClick={handleRetry}>
                    Try Again
                  </Button>
                </div>
              ) : projects.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
                  {projects.map((project) => {
                    // Extract reflection summary if available
                    const reflectionSummary =
                      project.reflection_answers &&
                      Array.isArray(project.reflection_answers) &&
                      project.reflection_answers.length > 0
                        ? project.reflection_answers
                            .map((qa: any) => qa.answer)
                            .join(" ")
                            .slice(0, 200)
                        : null;

                    return (
                      <PublicProjectCard
                        key={project.id}
                        emojiCode={generateEmojiCode(project.task?.title || project.id)}
                        title={project.task?.title || "Untitled Project"}
                        description={project.task?.description || ""}
                        skills={project.task?.required_skills || []}
                        submittedAt={project.submitted_at}
                        fileUrl={project.file_url}
                        proofId={project.id}
                        postId={project.post_id}
                        aiSummary={project.ai_summary}
                        reflectionSummary={reflectionSummary}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-16 bg-card rounded-2xl border border-border">
                  <Trophy className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-2">
                    Nothing public yet
                  </h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    This student hasn't shared any projects publicly yet. Check back later!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar - Desktop Only */}
          <aside className="hidden lg:block w-80 flex-shrink-0">
            <div className="sticky top-24">
              <PublicSuggestedStudents
                currentStudentId={portfolio?.student_id || ""}
                currentBranch={undefined}
                currentSkills={portfolio?.skills || []}
              />
            </div>
          </aside>
        </div>
      </main>

      {/* Followers/Following Modal */}
      <FollowersFollowingModal
        open={followModalOpen}
        onOpenChange={setFollowModalOpen}
        userId={portfolio?.student_id || ""}
        currentUserId={currentUserId}
        defaultTab={followModalTab}
      />
    </div>
  );
};

export default Portfolio;
