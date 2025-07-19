import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Youtube, BookOpen, Code } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface LearningResource {
  id: string;
  title: string;
  description: string | null;
  url: string;
  platform: string;
  branch: string;
  category: string | null;
  is_premium: boolean;
  created_at: string;
}

const StudentLearningResourcesPage = () => {
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [filteredResources, setFilteredResources] = useState<LearningResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("ALL");
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  const { toast } = useToast();

  const fetchResources = async () => {
    try {
      const { data, error } = await supabase
        .from('learning_resources')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setResources(data || []);
    } catch (error) {
      console.error('Error fetching learning resources:', error);
      toast({
        title: "Error",
        description: "Failed to load learning resources. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, []);

  useEffect(() => {
    let filtered = resources;

    if (selectedBranch !== "ALL") {
      filtered = filtered.filter(resource => 
        resource.branch === selectedBranch || resource.branch === "ALL"
      );
    }

    if (selectedPlatform !== "ALL") {
      filtered = filtered.filter(resource => resource.platform === selectedPlatform);
    }

    if (showFreeOnly) {
      filtered = filtered.filter(resource => !resource.is_premium);
    }

    setFilteredResources(filtered);
  }, [resources, selectedBranch, selectedPlatform, showFreeOnly]);

  const getPlatformIcon = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'youtube':
        return <Youtube className="h-4 w-4" />;
      case 'github':
        return <Code className="h-4 w-4" />;
      default:
        return <BookOpen className="h-4 w-4" />;
    }
  };

  const branches = [...new Set(resources.map(r => r.branch))].filter(b => b !== "ALL");
  const platforms = [...new Set(resources.map(r => r.platform))];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Recommended Learning Resources</h1>
        <p className="text-gray-600">Curated learning materials to boost your skills</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Branches</SelectItem>
                  {branches.map(branch => (
                    <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Platform</Label>
              <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Platforms</SelectItem>
                  {platforms.map(platform => (
                    <SelectItem key={platform} value={platform}>{platform}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="free-only"
                checked={showFreeOnly}
                onCheckedChange={setShowFreeOnly}
              />
              <Label htmlFor="free-only">Free Only</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredResources.map((resource) => (
          <Card key={resource.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg leading-tight">{resource.title}</CardTitle>
                {resource.is_premium && (
                  <Badge variant="secondary" className="ml-2">Premium</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-gray-600 text-sm line-clamp-3">
                {resource.description || "No description available"}
              </p>
              
              <div className="flex items-center space-x-2">
                {getPlatformIcon(resource.platform)}
                <span className="text-sm font-medium">{resource.platform}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {resource.category && (
                  <Badge variant="outline">{resource.category}</Badge>
                )}
                <Badge variant="outline">{resource.branch}</Badge>
              </div>

              <Button 
                className="w-full" 
                onClick={() => window.open(resource.url, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Resource
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredResources.length === 0 && !loading && (
        <div className="text-center py-12">
          <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No resources found</h3>
          <p className="text-gray-600">Try adjusting your filters or check back later for new resources.</p>
        </div>
      )}
    </div>
  );
};

export default StudentLearningResourcesPage;