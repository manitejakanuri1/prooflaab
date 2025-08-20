import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, ExternalLink, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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

interface ResourceFormData {
  title: string;
  description: string;
  url: string;
  platform: string;
  branch: string;
  category: string;
  is_premium: boolean;
}

const initialFormData: ResourceFormData = {
  title: "",
  description: "",
  url: "",
  platform: "",
  branch: "",
  category: "",
  is_premium: false,
};

const platforms = ["YouTube", "Coursera", "Udemy", "GitHub", "edX", "Khan Academy", "FreeCodeCamp", "Other"];
const branches = ["ALL", "CSE", "ECE", "ME", "EE", "CE"];

const ManageResourcesPage = () => {
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [filteredResources, setFilteredResources] = useState<LearningResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<LearningResource | null>(null);
  const [formData, setFormData] = useState<ResourceFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState({
    platform: "all",
    branch: "all",
    type: "all"
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    try {
      const { data, error } = await supabase
        .from("learning_resources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setResources(data || []);
      setFilteredResources(data || []);
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
      if (editingResource) {
        const { error } = await supabase
          .from("learning_resources")
          .update(formData)
          .eq("id", editingResource.id);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Resource updated successfully",
        });
      } else {
        const { error } = await supabase
          .from("learning_resources")
          .insert([formData]);

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
      branch: resource.branch,
      category: resource.category || "",
      is_premium: resource.is_premium,
    });
    setIsDialogOpen(true);
  };

  const openAddDialog = () => {
    setEditingResource(null);
    setFormData(initialFormData);
    setIsDialogOpen(true);
  };

  const applyFilters = () => {
    let filtered = resources;

    if (filters.platform && filters.platform !== "all") {
      filtered = filtered.filter(resource => resource.platform === filters.platform);
    }
    if (filters.branch && filters.branch !== "all") {
      filtered = filtered.filter(resource => resource.branch === filters.branch);
    }
    if (filters.type && filters.type !== "all") {
      if (filters.type === "free") {
        filtered = filtered.filter(resource => !resource.is_premium);
      } else if (filters.type === "premium") {
        filtered = filtered.filter(resource => resource.is_premium);
      }
    }

    setFilteredResources(filtered);
  };

  useEffect(() => {
    applyFilters();
  }, [filters, resources]);

  const clearFilters = () => {
    setFilters({ platform: "all", branch: "all", type: "all" });
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Manage Learning Resources</h1>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openAddDialog} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                Add New Resource
              </Button>
            </DialogTrigger>
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
                      <SelectItem value="Roadmaps">Roadmaps</SelectItem>
                      <SelectItem value="Courses">Courses</SelectItem>
                      <SelectItem value="Articles">Articles</SelectItem>
                      <SelectItem value="Videos">Videos</SelectItem>
                      <SelectItem value="GitHub Repos">GitHub Repos</SelectItem>
                      <SelectItem value="Tutorials">Tutorials</SelectItem>
                      <SelectItem value="Documentation">Documentation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="platform" className="text-sm font-medium text-foreground">Platform</Label>
                  <Select value={formData.platform} onValueChange={(value) => setFormData({ ...formData, platform: value })}>
                    <SelectTrigger className="rounded-lg border-border/50 focus:border-primary">
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg">
                      {platforms.map((platform) => (
                        <SelectItem key={platform} value={platform}>
                          {platform}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
        
        {/* Filters */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <span className="text-sm font-medium">Filters:</span>
              </div>
              
              <Select value={filters.platform} onValueChange={(value) => setFilters({...filters, platform: value})}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  {platforms.map((platform) => (
                    <SelectItem key={platform} value={platform}>{platform}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.branch} onValueChange={(value) => setFilters({...filters, branch: value})}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.type} onValueChange={(value) => setFilters({...filters, type: value})}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                      {resources.length === 0 ? "No learning resources found. Add your first resource!" : "No resources match the current filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredResources.map((resource) => (
                    <TableRow key={resource.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{resource.title}</div>
                          {resource.description && (
                            <div className="text-sm text-gray-500 truncate max-w-xs">
                              {resource.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{resource.branch}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{resource.platform}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={resource.is_premium ? "default" : "outline"}>
                          {resource.is_premium ? "Premium" : "Free"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(resource.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end space-x-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(resource.url, "_blank")}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditDialog(resource)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(resource.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ManageResourcesPage;