import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useProofUploads } from "@/hooks/useProofUploads";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Award, Eye, EyeOff, ExternalLink, Share, Star, Trophy, CheckCircle, Clock, Globe, Lock, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useState, useEffect } from "react";
import ProofFileButton from "@/components/proof/ProofFileButton";
import { hasOpenableProof } from "@/lib/proofFile";
import { getInitials } from "@/lib/utils";

const StudentPortfolioPage = () => {
  const { profile, loading: profileLoading } = useStudentProfile();
  const currentDate = new Date();
  const { data: uploads, isLoading: uploadsLoading, refetch } = useProofUploads(currentDate);
  const { portfolio, loading: portfolioLoading, updatePortfolioVisibility } = usePortfolio();
  const { toast } = useToast();
  const [localUploads, setLocalUploads] = useState(uploads || []);
  const [followModalOpen, setFollowModalOpen] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<"followers" | "following">("followers");

  // Sync localUploads with uploads whenever uploads changes
  useEffect(() => {
    if (uploads) {
      setLocalUploads(uploads);
    }
  }, [uploads]);

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

  const verifiedUploads = (localUploads || uploads || []).filter(upload => upload.status === 'Verified');

  const toggleProofVisibility = async (proofId: string, currentIsPublic: boolean) => {
    const newIsPublic = !currentIsPublic;
    
    // Optimistic update
    setLocalUploads(prev => 
      prev.map(upload => 
        upload.id === proofId 
          ? { ...upload, is_public: newIsPublic }
          : upload
      )
    );

    try {
      const { error } = await supabase.rpc('set_proof_publicity', {
        p_proof_id: proofId,
        p_is_public: newIsPublic
      });

      if (error) throw error;

      toast({
        title: newIsPublic ? "Proof is now public" : "Proof is now private",
        description: newIsPublic 
          ? "This proof is now visible on your public portfolio" 
          : "This proof is now hidden from your public portfolio",
      });

      // Refetch to ensure sync
      refetch();
    } catch (error) {
      // Revert optimistic update
      setLocalUploads(prev => 
        prev.map(upload => 
          upload.id === proofId 
            ? { ...upload, is_public: currentIsPublic }
            : upload
        )
      );
      
      toast({
        title: "Could not change visibility",
        description: "Try again.",
        variant: "destructive",
      });
    }
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
              
              <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Card className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm text-muted-foreground">Total XP</div>
                      <Star className="h-5 w-5 text-orange-500" />
                    </div>
                    <div className="text-3xl font-bold text-foreground">{profile?.total_xp || 0}</div>
                  </CardContent>
                </Card>
                
                <Card className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm text-muted-foreground">Trust Score</div>
                      <Trophy className="h-5 w-5 text-purple-500" />
                    </div>
                    <div className="text-3xl font-bold text-foreground">{profile?.trust_score || 0}</div>
                  </CardContent>
                </Card>
                
                <Card className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm text-muted-foreground">Completed Tasks</div>
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                    <div className="text-3xl font-bold text-foreground">{verifiedUploads.length}</div>
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm text-muted-foreground">Connections</div>
                      <Users className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex items-center gap-3 text-lg font-semibold text-foreground">
                    </div>
                  </CardContent>
                </Card>
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
                  className="p-4 border border-border rounded-lg hover:shadow-md transition-shadow bg-card relative"
                >
                  {/* Public/Private Toggle */}
                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => toggleProofVisibility(upload.id, upload.is_public)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                              upload.is_public
                                ? "bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-500/30"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                          >
                            {upload.is_public ? (
                              <>
                                <Globe className="h-3 w-3" />
                                <span>Public</span>
                              </>
                            ) : (
                              <>
                                <Lock className="h-3 w-3" />
                                <span>Private</span>
                              </>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{upload.is_public ? "Visible on your public portfolio" : "Hidden from public portfolio"}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <div className="flex items-start justify-between mb-2 pr-24">
                    <h4 className="font-medium text-foreground flex-1">
                      {upload.tasks?.title || 'Unknown Task'}
                    </h4>
                    <Badge className="bg-accent/20 text-accent-foreground ml-2 shrink-0">
                      ✅ Verified
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-muted-foreground mb-3">
                    Completed on {format(new Date(upload.submitted_at), "MMM dd, yyyy")}
                  </div>
                  
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center space-x-1">
                      <Award className="h-4 w-4 text-orange-500" />
                      <span className="text-sm font-medium">
                        {upload.tasks?.xp_reward || upload.tasks?.xp || 0} XP
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {upload.is_public && portfolio?.slug && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => window.open(`/portfolio/${portfolio.slug}`, '_blank')}
                          className="text-xs"
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Public Profile
                        </Button>
                      )}
                      
                      {hasOpenableProof(upload) && (
                        <ProofFileButton proof={upload} label="View" />
                      )}
                    </div>
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