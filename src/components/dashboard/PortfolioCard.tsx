
import { User, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";

export default function PortfolioCard() {
  const { portfolio, loading, updatePortfolioVisibility } = usePortfolio();
  const { toast } = useToast();

  const handleVisibilityToggle = async () => {
    if (!portfolio) return;

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

  const handleViewPortfolio = () => {
    if (portfolio?.slug) {
      window.open(`/portfolio/${portfolio.slug}`, '_blank');
    }
  };

  if (loading) {
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

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          👨‍💻 Public Portfolio
          <User className="h-5 w-5 text-purple-600" />
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleVisibilityToggle}
            disabled={!portfolio}
            className={portfolio?.is_public ? 'text-green-600 border-green-200' : 'text-gray-600'}
          >
            {portfolio?.is_public ? (
              <>
                <Eye className="h-4 w-4 mr-1" />
                Public
              </>
            ) : (
              <>
                <EyeOff className="h-4 w-4 mr-1" />
                Private
              </>
            )}
          </Button>
        </div>

        {portfolio && (
          <div className="text-xs text-gray-500 space-y-1">
            <p>URL: /portfolio/{portfolio.slug}</p>
            <p>Last updated: {new Date(portfolio.updated_at).toLocaleDateString()}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
