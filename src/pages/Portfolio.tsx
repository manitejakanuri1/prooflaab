
import { useParams } from "react-router-dom";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioProjects } from "@/hooks/usePortfolioProjects";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Mail, 
  Trophy, 
  Calendar, 
  ExternalLink, 
  CheckCircle, 
  Clock, 
  XCircle,
  Star
} from "lucide-react";
import { format } from "date-fns";

const Portfolio = () => {
  const { slug } = useParams<{ slug: string }>();
  
  console.log("Portfolio component loaded with slug:", slug);
  
  const { portfolio, loading, error } = usePortfolio(slug);
  const { projects, loading: projectsLoading } = usePortfolioProjects(
    portfolio?.student_id || ""
  );

  console.log("Portfolio data:", { portfolio, loading, error });

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Verified': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'Under Review': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'Rejected': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Verified': return 'bg-green-100 text-green-800';
      case 'Under Review': return 'bg-yellow-100 text-yellow-800';
      case 'Rejected': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-sm border-b border-orange-200/30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="text-gray-900 font-bold text-lg flex items-center space-x-3">
            <img 
              src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
              alt="ProofLabAI Logo" 
              className="h-10 w-10"
            />
            <span>ProofLabAI</span>
          </div>
          <Button variant="outline" onClick={() => window.location.href = '/'}>
            Back to Platform
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-6">
        {/* Profile Header */}
        <Card className="mb-8">
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
              <Avatar className="h-24 w-24">
                <AvatarImage 
                  src={portfolio.student_profiles.profile_photo_url || ""} 
                  alt={portfolio.student_profiles.full_name} 
                />
                <AvatarFallback className="text-2xl">
                  {portfolio.student_profiles.full_name.split(" ").map(n => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  {portfolio.student_profiles.full_name}
                </h1>
                <p className="text-gray-600 mb-4">
                  {portfolio.bio || "Passionate student building skills through hands-on projects."}
                </p>
                
                {/* Skills */}
                {portfolio.skills && portfolio.skills.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {portfolio.skills.map((skill, index) => (
                      <Badge key={index} variant="secondary">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Stats */}
                <div className="flex flex-wrap gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-500" />
                    <span className="font-medium">{portfolio.student_profiles.total_xp || 0} XP</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Trophy className={`h-4 w-4 ${getTrustScoreColor(trustScore)}`} />
                    <span className={`font-medium ${getTrustScoreColor(trustScore)}`}>
                      {getTrustScoreLabel(trustScore)} ({trustScore}/100)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <a 
                      href={`mailto:${portfolio.student_profiles.email}`}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Connect with me
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Projects Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-orange-600" />
              Projects & Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {projectsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading projects...</p>
              </div>
            ) : projects.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <Card key={project.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-semibold text-gray-900 line-clamp-2">
                          {project.task?.title || 'Untitled Project'}
                        </h3>
                        {getStatusIcon(project.status)}
                      </div>
                      
                      {project.task?.description && (
                        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                          {project.task.description}
                        </p>
                      )}
                      
                      <div className="flex items-center justify-between mb-3">
                        <Badge className={`text-xs ${getStatusColor(project.status)}`}>
                          {project.status}
                        </Badge>
                        {project.task?.xp_reward && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            {project.task.xp_reward} XP
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(project.submitted_at), 'MMM dd, yyyy')}
                        </div>
                        {project.file_url && (
                          <a
                            href={project.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Trophy className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No projects uploaded yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Portfolio;
