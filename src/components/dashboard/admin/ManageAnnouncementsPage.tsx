import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, Eye, Calendar, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, CheckCircle, XCircle } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'scheduled';
  created_at: string;
  created_by_admin: string;
}

interface AnnouncementFormData {
  title: string;
  description: string;
  status: 'draft' | 'published' | 'scheduled';
}

const initialFormData: AnnouncementFormData = {
  title: "",
  description: "",
  status: 'draft',
};

const ManageAnnouncementsPage = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [filteredAnnouncements, setFilteredAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [formData, setFormData] = useState<AnnouncementFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState({
    status: "all"
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    try {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      const announcementsWithStatus = (data || []).map(item => ({
        ...item,
        status: 'published' as const // Default status since announcements table doesn't have status column
      }));
      
      setAnnouncements(announcementsWithStatus);
      setFilteredAnnouncements(announcementsWithStatus);
    } catch (error) {
      console.error("Error fetching announcements:", error);
      toast({
        title: "Error",
        description: "Failed to fetch announcements",
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
        created_by_admin: (await supabase.auth.getUser()).data.user?.id,
      };

      if (editingAnnouncement) {
        const { error } = await supabase
          .from("announcements")
          .update({
            title: formData.title,
            description: formData.description
          })
          .eq("id", editingAnnouncement.id);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Announcement updated successfully",
        });
      } else {
        const { error } = await supabase
          .from("announcements")
          .insert([submitData]);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Announcement created successfully",
        });
      }

      setIsDialogOpen(false);
      setEditingAnnouncement(null);
      setFormData(initialFormData);
      fetchAnnouncements();
    } catch (error) {
      console.error("Error saving announcement:", error);
      toast({
        title: "Error",
        description: "Failed to save announcement",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this announcement?")) return;

    try {
      const { error } = await supabase
        .from("announcements")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Announcement deleted successfully",
      });

      fetchAnnouncements();
    } catch (error) {
      console.error("Error deleting announcement:", error);
      toast({
        title: "Error",
        description: "Failed to delete announcement",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    // Since announcements table doesn't have status column, we'll just show a message
    toast({
      title: "Info",
      description: "Status management not available for announcements",
    });
  };

  const openEditDialog = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setFormData({
      title: announcement.title,
      description: announcement.description || "",
      status: 'published', // Default since no status in DB
    });
    setIsDialogOpen(true);
  };

  const openAddDialog = () => {
    setEditingAnnouncement(null);
    setFormData(initialFormData);
    setIsDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    return (
      <Badge 
        className={
          status === 'published' ? 'bg-green-100 text-green-800 hover:bg-green-100' :
          status === 'draft' ? 'bg-gray-100 text-gray-800 hover:bg-gray-100' :
          status === 'scheduled' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' : 
          'bg-gray-100 text-gray-800 hover:bg-gray-100'
        }
      >
        {status === 'published' ? '✅ Published' : 
         status === 'draft' ? '⚪ Draft' : 
         status === 'scheduled' ? '⚠️ Scheduled' : status}
      </Badge>
    );
  };

  const applyFilters = () => {
    let filtered = announcements;

    if (filters.status && filters.status !== "all") {
      filtered = filtered.filter(announcement => announcement.status === filters.status);
    }

    setFilteredAnnouncements(filtered);
  };

  useEffect(() => {
    applyFilters();
  }, [filters, announcements]);

  const clearFilters = () => {
    setFilters({ status: "all" });
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
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">📢 Announcements Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Post and manage announcements for the entire platform.</p>
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
          {/* Search and Filters */}
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="sm">
              All Announcements
            </Button>
          </div>

          {/* Table */}
          {filteredAnnouncements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-6xl mb-4">📢</div>
              <p className="text-muted-foreground text-lg">No announcements yet. Keep your community updated!</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-muted-foreground/10">
                  <TableHead className="font-semibold">Title</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Created</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAnnouncements.map((announcement) => (
                  <TableRow key={announcement.id} className="hover:bg-muted/30 border-muted-foreground/10">
                    <TableCell>
                      <div>
                        <div className="font-semibold text-foreground">{announcement.title}</div>
                        {announcement.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-md mt-1">
                            {announcement.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(announcement.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(announcement.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem>
                            <Eye className="mr-2 h-4 w-4" />
                            View Announcement
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(announcement)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(announcement.id)}
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

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAnnouncement ? "Edit Announcement" : "Create New Announcement"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>
            
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={4}
                required
              />
            </div>
            
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : editingAnnouncement ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageAnnouncementsPage;