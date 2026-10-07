import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, ExternalLink, MoreVertical, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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
  status: string;
}

interface ResourceFormData {
  title: string;
  description: string;
  url: string;
  platform: string;
  category: string;
}

const initialFormData: ResourceFormData = {
  title: "",
  description: "",
  url: "",
  platform: "",
  category: "",
};

const categories = ["Roadmaps", "Courses", "Articles", "Videos", "GitHub Repos"];

const ManageResourcesPage = () => {
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<LearningResource | null>(null);
  const [formData, setFormData] = useState<ResourceFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [previewResource, setPreviewResource] = useState<LearningResource | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchResources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchResources = async () => {
    try {
      const { data, error } = await supabase
        .from("learning_resources")  
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setResources(data || []);
    } catch (error) {
      console.error("Error fetching resources:", error);
      toast({
        title: "Error",
        description: "Failed to fetch learning resources",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const submitData = {
        title: formData.title,
        description: formData.description,
        url: formData.url,
        platform: formData.platform,
        category: formData.category,
        branch: 'ALL',
        is_premium: false,
        status: 'approved'
      };

      if (editingResource) {
        const { error } = await supabase
          .from("learning_resources")
          .update(submitData)
          .eq("id", editingResource.id);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Resource updated successfully",
        });
      } else {
        const { error } = await supabase
          .from("learning_resources")
          .insert([submitData]);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Resource added successfully",
        });
      }

      setIsDialogOpen(false);
      setEditingResource(null);
      setFormData(initialFormData);
      fetchResources();
    } catch (error) {
      console.error("Error saving resource:", error);
      toast({
        title: "Error",
        description: "Failed to save resource",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this resource?")) return;

    try {
      const { error } = await supabase
        .from("learning_resources")
        .delete()
        .eq("id", id);

      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Resource deleted successfully",
      });
      
      fetchResources();
    } catch (error) {
      console.error("Error deleting resource:", error);
      toast({
        title: "Error",
        description: "Failed to delete resource",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (resource: LearningResource) => {
    setEditingResource(resource);
    setFormData({
      title: resource.title,
      description: resource.description || "",
      url: resource.url,
      platform: resource.platform,
      category: resource.category || "",
    });
    setIsDialogOpen(true);
  };

  const openAddDialog = () => {
    setEditingResource(null);
    setFormData(initialFormData);
    setIsDialogOpen(true);
  };

  const openPreviewDialog = (resource: LearningResource) => {
    setPreviewResource(resource);
    setIsPreviewOpen(true);
  };

  const getStatusBadge = (status: string) => {
    return (
      <Badge 
        className={
          status === 'approved' ? 'bg-green-100 text-green-800 hover:bg-green-100' :
          status === 'pending' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' :
          status === 'rejected' ? 'bg-red-100 text-red-800 hover:bg-red-100' : 
          'bg-gray-100 text-gray-800 hover:bg-gray-100'
        }
      >
        {status === 'approved' ? '✅ Approved' : 
         status === 'pending' ? '⚠️ Pending' : 
         status === 'rejected' ? '🔴 Rejected' : status}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="h-32 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">📚 Resources Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Curate learning resources for students.</p>
        </div>
        <Button 
          onClick={openAddDialog}
          className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 rounded-lg shadow-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add New
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          {/* Table */}
          {resources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-6xl mb-4">📖</div>
              <p className="text-muted-foreground text-lg">No resources available. Start adding content to help students learn.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-muted-foreground/10">
                  <TableHead className="font-semibold">Title</TableHead>
                  <TableHead className="font-semibold">Category</TableHead>
                  <TableHead className="font-semibold">Platform</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Created</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => (
                  <TableRow key={resource.id} className="hover:bg-muted/30 border-muted-foreground/10">
                    <TableCell>
                      <div>
                        <div className="font-semibold text-foreground cursor-pointer hover:text-primary">
                          {resource.title}
                        </div>
                        {resource.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-md mt-1">
                            {resource.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{resource.category || 'General'}</TableCell>
                    <TableCell>{resource.platform}</TableCell>
                    <TableCell>{getStatusBadge(resource.status || 'approved')}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(resource.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openPreviewDialog(resource)}>
                            <Eye className="mr-2 h-4 w-4" />
                            Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(resource)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(resource.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewResource?.title}</DialogTitle>
            <DialogDescription>
              {previewResource?.description || "No description available"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            {/* Resource Metadata */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{previewResource?.platform}</Badge>
              <Badge variant="outline">{previewResource?.category || 'General'}</Badge>
              <Badge variant="outline">
                {previewResource?.created_at && new Date(previewResource.created_at).toLocaleDateString()}
              </Badge>
            </div>

            {/* YouTube Embed or Link */}
            {previewResource && isYouTubeUrl(previewResource.url) ? (
              <div className="w-full">
                {getYouTubeEmbedUrl(previewResource.url) ? (
                  <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                    <iframe
                      src={getYouTubeEmbedUrl(previewResource.url)!}
                      className="absolute top-0 left-0 w-full h-full rounded-lg"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <div className="p-8 bg-muted rounded-lg text-center">
                    <p className="text-destructive">Invalid YouTube Link</p>
                    <a 
                      href={previewResource.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline mt-2 inline-block"
                    >
                      Open original link
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 bg-muted rounded-lg text-center">
                <ExternalLink className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-4">This resource links to an external website</p>
                <Button asChild>
                  <a 
                    href={previewResource?.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Visit Resource
                  </a>
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border-0 bg-background">
          <DialogHeader className="border-b border-border/50 pb-4">
            <DialogTitle className="text-xl font-semibold text-foreground flex items-center gap-2">
              📚 {editingResource ? "Edit Resource" : "Add New Resource"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6 p-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-sm font-medium text-foreground">Resource Title</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Complete React Course"
                className="rounded-lg border-border/50 focus:border-primary transition-colors"
                required
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="category" className="text-sm font-medium text-foreground">Category</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger className="rounded-lg border-border/50 focus:border-primary">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="platform" className="text-sm font-medium text-foreground">Platform</Label>
                <Input
                  id="platform"
                  value={formData.platform}
                  onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                  placeholder="e.g., YouTube, Coursera"
                  className="rounded-lg border-border/50 focus:border-primary transition-colors"
                  required
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="url" className="text-sm font-medium text-foreground">Link</Label>
              <Input
                id="url"
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://example.com/course"
                className="rounded-lg border-border/50 focus:border-primary transition-colors"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium text-foreground">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe what students will learn from this resource..."
                className="rounded-lg border-border/50 focus:border-primary transition-colors min-h-[100px]"
                rows={4}
              />
            </div>
            
            <div className="flex justify-end space-x-3 pt-4 border-t border-border/50">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg px-6"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={submitting}
                className="rounded-lg px-6 bg-primary hover:bg-primary/90 transition-colors"
              >
                {submitting ? "Adding..." : editingResource ? "Update Resource" : "Add Resource"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageResourcesPage;