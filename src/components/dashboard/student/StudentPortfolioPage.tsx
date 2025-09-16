import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useProofUploads } from "@/hooks/useProofUploads";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Copy, Eye, EyeOff } from "lucide-react";

const StudentPortfolioPage = () => {
  const { profile: studentProfile, loading: profileLoading } = useStudentProfile();
  const { data: proofUploads, isLoading: proofsLoading } = useProofUploads(new Date());
  const { portfolio, loading: portfolioLoading, updatePortfolioVisibility } = usePortfolio();
  const { toast } = useToast();

  const isLoading = profileLoading || proofsLoading || portfolioLoading;

  if (isLoading) {
    return (
      <Card className="hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded mb-4"></div>
            <div className="h-10 bg-gray-200 rounded mb-4"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleViewPortfolio = () => {
    if (portfolio?.slug) {
      window.open(`/portfolio/${portfolio.slug}`, '_blank');
    } else {
      toast({
        title: "Error",
        description: "Portfolio URL not available",
        variant: "destructive",
      });
    }
  };

  const handleVisibilityToggle = async () => {
    if (!portfolio || !portfolio.id) {
      toast({
        title: "Error",
        description: "Portfolio not found. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updatePortfolioVisibility(!portfolio.is_public);
      toast({
        title: "Portfolio Updated",
        description: `Portfolio is now ${!portfolio.is_public ? 'public' : 'private'}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update portfolio visibility",
        variant: "destructive",
      });
    }
  };

  const handleShare = async () => {
    if (portfolio?.slug) {
      const portfolioUrl = `${window.location.origin}/portfolio/${portfolio.slug}`;
      await navigator.clipboard.writeText(portfolioUrl);
      toast({
        title: "Portfolio URL copied!",
        description: "Share this link to show your portfolio to others.",
      });
    }
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          👨‍💻 My Portfolio
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          className="w-full bg-purple-600 hover:bg-purple-700"
          onClick={handleViewPortfolio}
          disabled={!portfolio}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          View My Portfolio
        </Button>
        
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <span className="text-sm font-medium">Portfolio Visibility</span>
          <div className="flex items-center gap-2">
            <Switch
              checked={portfolio?.is_public || false}
              onCheckedChange={handleVisibilityToggle}
              disabled={!portfolio}
            />
            <span className="text-sm text-gray-600">
              {portfolio?.is_public ? 'Public' : 'Private'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <span className="text-sm font-medium">Share Portfolio</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            disabled={!portfolio?.slug}
          >
            <Copy className="h-4 w-4 mr-1" />
            Copy Link
          </Button>
        </div>

        {portfolio && (
          <div className="text-xs text-gray-500 space-y-1">
            <p>URL: /portfolio/{portfolio.slug}</p>
            <p>Last updated: {new Date(portfolio.updated_at).toLocaleDateString()}</p>
          </div>
        )}

        {portfolio?.skills && portfolio.skills.length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Skills:</span>
            <div className="flex flex-wrap gap-1">
              {portfolio.skills.slice(0, 3).map((skill, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {skill}
                </Badge>
              ))}
              {portfolio.skills.length > 3 && (
                <Badge variant="outline" className="text-xs">
                  +{portfolio.skills.length - 3} more
                </Badge>
              )}
            </div>
          </div>
        )}

        {proofUploads && proofUploads.filter(proof => proof.status === 'Verified').length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Verified Achievements:</span>
            <Badge variant="secondary" className="bg-green-50 text-green-700">
              {proofUploads.filter(proof => proof.status === 'Verified').length} Verified
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StudentPortfolioPage;