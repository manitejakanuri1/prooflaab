import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Youtube, BookOpen, Code, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Utility function to extract YouTube video ID and convert to embed URL
const getYouTubeEmbedUrl = (url: string): string | null => {
  try {
    const urlObj = new URL(url);
    
    // Handle youtube.com/watch?v=VIDEO_ID format
    if (urlObj.hostname.includes('youtube.com') && urlObj.searchParams.has('v')) {
      const videoId = urlObj.searchParams.get('v');
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    
    // Handle youtu.be/VIDEO_ID format
    if (urlObj.hostname === 'youtu.be') {
      const videoId = urlObj.pathname.slice(1);
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    
    // Already in embed format
    if (urlObj.pathname.includes('/embed/')) {
      return url;
    }
    
    return null;
  } catch {
    return null;
  }
};

const isYouTubeUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('youtube.com') || urlObj.hostname === 'youtu.be';
  } catch {
    return false;
  }
};

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
              <p className="text-muted-foreground text-sm line-clamp-2">
                {resource.description || "No description available"}
              </p>
              
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center space-x-2">
                  {getPlatformIcon(resource.platform)}
                  <span>{resource.platform}</span>
                </div>
                <span>{new Date(resource.created_at).toLocaleDateString()}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {resource.category && (
                  <Badge variant="outline" className="text-xs">{resource.category}</Badge>
                )}
                <Badge variant="outline" className="text-xs">{resource.branch}</Badge>
              </div>

              {/* YouTube Embed or External Link */}
              {isYouTubeUrl(resource.url) ? (
                <div className="w-full">
                  {getYouTubeEmbedUrl(resource.url) ? (
                    <div className="relative w-full rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
                      <iframe
                        src={getYouTubeEmbedUrl(resource.url)!}
                        className="absolute top-0 left-0 w-full h-full"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <div className="p-4 bg-destructive/10 rounded-lg flex items-center gap-2 text-destructive text-sm">
                      <AlertCircle className="h-4 w-4" />
                      <span>Invalid YouTube Link</span>
                    </div>
                  )}
                </div>
              ) : (
                <Button 
                  className="w-full" 
                  variant="default"
                  asChild
                >
                  <a 
                    href={resource.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Visit Resource
                  </a>
                </Button>
              )}
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