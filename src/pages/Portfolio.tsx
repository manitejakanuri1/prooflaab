
import { useParams } from "react-router-dom";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioProjects } from "@/hooks/usePortfolioProjects";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileThumbnail } from "@/components/portfolio/FileThumbnail";
import { 
  Mail, 
  Trophy, 
  Calendar, 
  ExternalLink, 
  Star,
  Shield,
  User
} from "lucide-react";
import { format } from "date-fns";
import { useEffect } from "react";

const Portfolio = () => {
  const { slug } = useParams<{ slug: string }>();
  
  const { portfolio, loading, error } = usePortfolio(slug);
  const { projects, loading: projectsLoading } = usePortfolioProjects(
    portfolio?.student_id || ""
  );

  // SEO Meta tags
  useEffect(() => {
    if (portfolio) {
      const title = `${portfolio.student_profiles.full_name} - ProofLab Portfolio`;
      const description = `View ${portfolio.student_profiles.full_name}'s verified projects and achievements on ProofLab. ${portfolio.student_profiles.total_xp} XP earned across ${projects.length} completed tasks.`;
      
      document.title = title;
      
      // Update meta description
      let metaDescription = document.querySelector('meta[name="description"]');
      if (!metaDescription) {
        metaDescription = document.createElement('meta');
        metaDescription.setAttribute('name', 'description');
        document.head.appendChild(metaDescription);
      }
      metaDescription.setAttribute('content', description);
      
      // Open Graph tags
      const updateMetaTag = (property: string, content: string) => {
        let meta = document.querySelector(`meta[property="${property}"]`);
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('property', property);
          document.head.appendChild(meta);
        }
        meta.setAttribute('content', content);
      };
      
      updateMetaTag('og:title', title);
      updateMetaTag('og:description', description);
      updateMetaTag('og:type', 'profile');
      updateMetaTag('og:url', window.location.href);
      if (portfolio.student_profiles.profile_photo_url) {
        updateMetaTag('og:image', portfolio.student_profiles.profile_photo_url);
      }
    }
  }, [portfolio, projects.length]);

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
    console.log("Portfolio error or not found:", { error, portfolio });
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center">
        <Card className="max-w-md mx-auto">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Portfolio Not Found</h1>
            <p className="text-gray-600 mb-4">
              This portfolio doesn't exist or is set to private.
            </p>
            <Button onClick={() => window.location.href = '/'}>
              Go to ProofLabAI
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Verified': return 'bg-green-100 text-green-800 border-green-200';
      case 'Under Review': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Rejected': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getTrustScoreLabel = (score: number) => {
    if (score >= 80) return 'Highly Trusted';
    if (score >= 60) return 'Trusted';
    return 'Building Trust';
  };

  const trustScore = portfolio.student_profiles.trust_score || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/95 to-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="text-foreground font-bold text-lg flex items-center space-x-3">
            <img 
              src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
              alt="ProofLab Logo" 
              className="h-8 w-8 sm:h-10 sm:w-10"
            />
            <span className="hidden sm:inline">ProofLab</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.href = '/'}>
            Back to Platform
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* Profile Header */}
        <Card className="mb-6 sm:mb-8 shadow-lg border-border/50">
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 lg:gap-6">
                <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-4 border-border">
                  <AvatarImage 
                    src={portfolio.student_profiles.profile_photo_url || ""} 
                    alt={portfolio.student_profiles.full_name} 
                  />
                  <AvatarFallback className="text-xl sm:text-2xl bg-muted">
                    {portfolio.student_profiles.full_name.split(" ").map(n => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                
                <div className="text-center sm:text-left">
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
                    {portfolio.student_profiles.full_name}
                  </h1>
                  <p className="text-muted-foreground mb-4 text-sm sm:text-base max-w-md">
                    {portfolio.bio || "Passionate student building skills through hands-on projects."}
                  </p>
                </div>
              </div>
              
              <div className="flex-1 w-full lg:w-auto">
                {/* Skills */}
                {portfolio.skills && portfolio.skills.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4 justify-center sm:justify-start">
                    {portfolio.skills.map((skill, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center justify-center sm:justify-start gap-2 p-3 bg-muted/30 rounded-lg">
                    <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                    <div>
                      <div className="font-bold text-foreground">{portfolio.student_profiles.total_xp || 0}</div>
                      <div className="text-xs text-muted-foreground">Total XP</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-center sm:justify-start gap-2 p-3 bg-muted/30 rounded-lg">
                    <Shield className={`h-4 w-4 flex-shrink-0 ${getTrustScoreColor(trustScore)}`} />
                    <div>
                      <div className={`font-bold ${getTrustScoreColor(trustScore)}`}>{trustScore}/100</div>
                      <div className="text-xs text-muted-foreground">Trust Score</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-center sm:justify-start gap-2 p-3 bg-muted/30 rounded-lg">
                    <Trophy className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <div>
                      <div className="font-bold text-foreground">{projects.length}</div>
                      <div className="text-xs text-muted-foreground">Completed</div>
                    </div>
                  </div>
                </div>

                {/* Contact */}
                <div className="mt-4 flex justify-center sm:justify-start">
                  <a 
                    href={`mailto:${portfolio.student_profiles.email}`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm"
                  >
                    <Mail className="h-4 w-4" />
                    Get in touch
                  </a>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Projects Section */}
        <Card className="shadow-lg border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Trophy className="h-5 w-5 text-primary" />
              Verified Projects ({projects.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {projectsLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading projects...</p>
              </div>
            ) : projects.length > 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <Card key={project.id} className="group hover:shadow-lg transition-all duration-300 border-border/50 hover:border-primary/20">
                    <CardContent className="p-0">
                      {/* Thumbnail */}
                      <div className="relative">
                        <a
                          href={project.file_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                          onClick={(e) => !project.file_url && e.preventDefault()}
                        >
                          <FileThumbnail
                            fileUrl={project.file_url}
                            fileName={project.task?.title}
                            className="h-48 w-full"
                          />
                        </a>
                        
                        {/* Status Badge */}
                        <div className="absolute top-3 right-3">
                          <Badge className={`text-xs border ${getStatusColor(project.status)}`}>
                            ✓ Verified
                          </Badge>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="p-4">
                        <h3 className="font-semibold text-foreground mb-2 line-clamp-2 text-sm sm:text-base">
                          {project.task?.title || 'Untitled Project'}
                        </h3>
                        
                        {project.task?.description && (
                          <p className="text-xs sm:text-sm text-muted-foreground mb-3 line-clamp-2">
                            {project.task.description}
                          </p>
                        )}
                        
                        {/* XP and Date */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(project.submitted_at), 'MMM dd, yyyy')}
                          </div>
                          {project.task?.xp_reward && (
                            <div className="flex items-center gap-1 font-medium text-yellow-600">
                              <Star className="h-3 w-3" />
                              {project.task.xp_reward} XP
                            </div>
                          )}
                        </div>

                        {/* View Link */}
                        {project.file_url && (
                          <a
                            href={project.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-3 text-xs text-primary hover:text-primary/80 transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View submission
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="max-w-md mx-auto">
                  <User className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No proofs yet</h3>
                  <p className="text-muted-foreground text-sm">
                    This student hasn't uploaded any proofs yet. Check back later to see their amazing work!
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Portfolio;
