import { fmtDay } from "@/lib/ist";
import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, MoreVertical, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface LearningResource {
  id: string;
  title: string;
  description: string | null;
  body: string | null;
  url: string | null;
  platform: string;
  branch: string;
  category: string | null;
  is_premium: boolean;
  created_at: string;
  status: string;
}

// Owner 12 Nov 2026 (A2 option b, migration 335): a resource is TEXT written here and read inside the student app.
// Students are never sent outside the app, so there is no link field; old link-only rows are not shown to students.
// Limits match the learning_resources_text_length check on the table.
interface ResourceFormData {
  title: string;
  description: string;
  body: string;
  category: string;
}

const initialFormData: ResourceFormData = { title: "", description: "", body: "", category: "" };

const hasText = (r: LearningResource) => (r.body ?? "").trim() !== "";

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
    if (!formData.title.trim() || !formData.body.trim()) {
      toast({ title: "Add a title and the text students read", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    try {
      const submitData = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        body: formData.body,
        category: formData.category.trim() || null,
        branch: 'ALL',
        is_premium: false,
        // E2E O2: the table allows draft / published / archived; students read 'published'
        status: 'published'
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
      body: resource.body || "",
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
          status === 'approved' || status === 'published' ? 'bg-verified/10 text-verified hover:bg-verified/10' :
          status === 'pending' ? 'bg-compete/10 text-compete hover:bg-compete/10' :
          status === 'rejected' ? 'bg-alert/10 text-alert hover:bg-alert/10' :
          'bg-muted text-foreground hover:bg-muted'
        }
      >
        {status === 'published' ? '✅ Published' :
         status === 'approved' ? '✅ Approved' :
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
                  <TableHead className="font-semibold">Tag</TableHead>
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
                    <TableCell>{resource.category || '-'}</TableCell>
                    <TableCell>
                      {getStatusBadge(resource.status || 'approved')}
                      {!hasText(resource) && (
                        <div className="text-xs text-alert mt-1" data-testid="link-only-note">Link-only: not shown to students - add text</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDay(resource.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Actions for ${resource.title}`}>
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
                            className="text-alert focus:text-alert"
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
            <div className="flex flex-wrap gap-2">
              {previewResource?.category && <Badge variant="outline">{previewResource.category}</Badge>}
              <Badge variant="outline">
                {previewResource?.created_at && fmtDay(previewResource.created_at)}
              </Badge>
            </div>
            {previewResource && hasText(previewResource) ? (
              <p className="text-sm whitespace-pre-line break-words">{previewResource.body}</p>
            ) : (
              <div className="p-4 bg-muted rounded-lg text-sm space-y-1">
                <p className="text-alert">Link-only: not shown to students - add text</p>
                {previewResource?.url && <p className="text-muted-foreground break-all">Old link: {previewResource.url}</p>}
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
                placeholder="e.g., How Python lists work"
                maxLength={150}
                className="rounded-lg border-border/50 focus:border-primary transition-colors"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium text-foreground">Short summary (optional)</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="One line on what the student will learn"
                maxLength={300}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="body" className="text-sm font-medium text-foreground">Text students read</Label>
              <Textarea
                id="body"
                value={formData.body}
                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                placeholder="Write the resource here. Students read it inside ProofLab; links are shown as plain text."
                className="min-h-[200px]"
                maxLength={20000}
                required
              />
              <p className="text-xs text-muted-foreground">{formData.body.length} / 20000</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category" className="text-sm font-medium text-foreground">Skill or track tag (optional)</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="e.g., Python"
                maxLength={60}
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
