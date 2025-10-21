import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useProofUploads } from "@/hooks/useProofUploads";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Award, Eye, EyeOff, ExternalLink, Share } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const StudentPortfolioPage = () => {
  const { profile, loading: profileLoading } = useStudentProfile();
  const currentDate = new Date();
  const { data: uploads, isLoading: uploadsLoading } = useProofUploads(currentDate);
  const { portfolio, loading: portfolioLoading, updatePortfolioVisibility } = usePortfolio();
  const { toast } = useToast();

  if (profileLoading || uploadsLoading || portfolioLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const verifiedUploads = uploads?.filter(upload => upload.status === 'Verified') || [];

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleShare = () => {
    if (!portfolio?.slug) {
      toast({
        title: "Portfolio not ready",
        description: "Your portfolio is being set up. Please try again in a moment.",
        variant: "destructive",
      });
      return;
    }
    
    const portfolioUrl = `${window.location.origin}/portfolio/${portfolio.slug}`;
    navigator.clipboard.writeText(portfolioUrl);
    toast({
      title: "Portfolio link copied!",
      description: "Share this link to showcase your achievements.",
    });
  };

  const toggleVisibility = async () => {
    if (!portfolio) return;
    
    try {
      await updatePortfolioVisibility(!portfolio.is_public);
      toast({
        title: portfolio.is_public ? "Portfolio made private" : "Portfolio made public",
        description: portfolio.is_public 
          ? "Your portfolio is now hidden from public view." 
          : "Your portfolio is now visible to everyone.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update portfolio visibility",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0 sm:justify-between">
            <CardTitle className="text-lg sm:text-xl font-semibold">My Portfolio</CardTitle>
            <div className="flex flex-col xs:flex-row items-start xs:items-center gap-2 xs:gap-4">
              <div className="flex items-center gap-2">
                {portfolio?.is_public ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                <span className="text-xs sm:text-sm">{portfolio?.is_public ? 'Public' : 'Private'}</span>
                <Switch checked={portfolio?.is_public || false} onCheckedChange={toggleVisibility} />
              </div>
              <Button onClick={handleShare} className="bg-orange-600 hover:bg-orange-700 w-full xs:w-auto text-xs sm:text-sm" size="sm">
                <Share className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                Share Portfolio
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24 mx-auto sm:mx-0">
              <AvatarImage src={profile?.profile_photo_url || undefined} alt={profile?.full_name} />
              <AvatarFallback className="bg-primary/10 text-primary text-base sm:text-lg">
                {getInitials(profile?.full_name || 'Student')}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1">
              <h2 className="text-xl sm:text-2xl font-bold text-foreground text-center sm:text-left">{profile?.full_name}</h2>
              <p className="text-muted-foreground mb-3 sm:mb-4 text-sm sm:text-base text-center sm:text-left truncate">{profile?.email}</p>
              
              <div className="grid grid-cols-1 xs:grid-cols-3 gap-3 sm:gap-4">
                <div className="text-center p-4 bg-primary/10 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{profile?.total_xp || 0}</div>
                  <div className="text-sm text-muted-foreground">Total XP</div>
                </div>
                <div className="text-center p-4 bg-secondary/20 rounded-lg">
                  <div className="text-2xl font-bold text-secondary-foreground">{profile?.trust_score || 0}</div>
                  <div className="text-sm text-muted-foreground">Trust Score</div>
                </div>
                <div className="text-center p-4 bg-accent/20 rounded-lg">
                  <div className="text-2xl font-bold text-accent-foreground">{verifiedUploads.length}</div>
                  <div className="text-sm text-muted-foreground">Completed Tasks</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verified Tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Award className="h-5 w-5 text-orange-600" />
            <span>Verified Achievements</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {verifiedUploads.length === 0 ? (
            <div className="text-center py-8">
              <Award className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No verified tasks yet</h3>
              <p className="text-muted-foreground">Complete and submit tasks to build your portfolio.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {verifiedUploads.map((upload) => (
                <div
                  key={upload.id}
                  className="p-4 border border-border rounded-lg hover:shadow-md transition-shadow bg-card"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-foreground flex-1">
                      {upload.tasks?.title || 'Unknown Task'}
                    </h4>
                    <Badge className="bg-accent/20 text-accent-foreground ml-2">
                      ✅ Verified
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-muted-foreground mb-3">
                    Completed on {format(new Date(upload.submitted_at), "MMM dd, yyyy")}
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1">
                      <Award className="h-4 w-4 text-orange-500" />
                      <span className="text-sm font-medium">
                        {upload.tasks?.xp_reward || upload.tasks?.xp || 0} XP
                      </span>
                    </div>
                    
                    {upload.file_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(upload.file_url!, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bio Section */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-foreground mb-2">Bio</h4>
              <p className="text-muted-foreground">
                {portfolio?.bio || "No bio added yet. Update your portfolio in Settings to add a bio!"}
              </p>
            </div>
            
            <div>
              <h4 className="font-medium text-foreground mb-2">Skills</h4>
              <div className="flex flex-wrap gap-2">
                {portfolio?.skills && portfolio.skills.length > 0 ? (
                  portfolio.skills.map((skill, index) => (
                    <Badge key={index} variant="outline" className="bg-primary/10 text-primary">
                      {skill}
                    </Badge>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">No skills added yet. Update your portfolio in Settings to add skills!</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentPortfolioPage;