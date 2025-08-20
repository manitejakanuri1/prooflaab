import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Plus, Briefcase, BookOpen, Megaphone, MoreVertical, Eye, CheckCircle, XCircle, Trash2, Youtube, FileText, Globe } from "lucide-react";

interface ContentManagementProps {
  type: 'jobs' | 'resources' | 'announcements';
}

const ContentManagement = ({ type }: ContentManagementProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'edit' | 'delete'>('approve');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const getTableName = () => {
    switch (type) {
      case 'jobs': return 'job_opportunities';
      case 'resources': return 'learning_resources';
      case 'announcements': return 'announcements';
    }
  };

  const { data: items, isLoading } = useQuery({
    queryKey: [`admin-${type}`, searchTerm],
    queryFn: async () => {
      let query = supabase.from(getTableName()).select('*');

      if (searchTerm) {
        query = query.ilike('title', `%${searchTerm}%`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, updates }: { itemId: string; updates: any }) => {
      const { error } = await supabase
        .from(getTableName())
        .update(updates)
        .eq('id', itemId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin-${type}`] });
      toast({
        title: "Success",
        description: `${type.slice(0, -1)} ${actionType}d successfully.`,
      });
      setSelectedItem(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to ${actionType} ${type.slice(0, -1)}: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const createItemMutation = useMutation({
    mutationFn: async (newItem: any) => {
      const { error } = await supabase
        .from(getTableName())
        .insert([newItem]);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin-${type}`] });
      toast({
        title: "Success",
        description: `${type.slice(0, -1)} created successfully.`,
      });
      setIsCreateModalOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create ${type.slice(0, -1)}: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleItemAction = (item: any, action: 'approve' | 'reject' | 'edit' | 'delete') => {
    setSelectedItem(item);
    setActionType(action);
  };

  const confirmAction = () => {
    if (!selectedItem) return;

    // Announcements don't have status updates, only delete
    if (type === 'announcements' && actionType === 'delete') {
      updateItemMutation.mutate({
        itemId: selectedItem.id,
        updates: { deleted: true } // or however you want to handle deletion
      });
      return;
    }

    let updates: any = {};
    
    if (actionType === 'approve') {
      updates.status = 'approved';
    } else if (actionType === 'reject') {
      updates.status = 'rejected';
    } else if (actionType === 'delete') {
      updates.status = 'deleted';
    }

    updateItemMutation.mutate({
      itemId: selectedItem.id,
      updates
    });
  };

  const getStatusBadge = (item: any) => {
    if (type === 'announcements') {
      const status = item.status || 'published';
      return (
        <Badge 
          className={
            status === 'published' ? 'bg-green-100 text-green-800 hover:bg-green-100' :
            status === 'draft' ? 'bg-gray-100 text-gray-800 hover:bg-gray-100' :
            status === 'scheduled' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' : 
            'bg-gray-100 text-gray-800 hover:bg-gray-100'
          }
        >
          ✅ {status === 'published' ? 'Published' : status === 'draft' ? '⚪ Draft' : status === 'scheduled' ? '⚠️ Scheduled' : status}
        </Badge>
      );
    }
    
    const status = (item as any).status || 'approved';
    return (
      <Badge 
        className={
          status === 'approved' || status === 'active' ? 'bg-green-100 text-green-800 hover:bg-green-100' :
          status === 'pending' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' :
          status === 'rejected' || status === 'closed' ? 'bg-red-100 text-red-800 hover:bg-red-100' : 
          'bg-gray-100 text-gray-800 hover:bg-gray-100'
        }
      >
        {status === 'approved' || status === 'active' ? '✅' : 
         status === 'pending' ? '⚠️' : 
         status === 'rejected' || status === 'closed' ? '🔴' : '⚪'} {status}
      </Badge>
    );
  };

  const getIcon = () => {
    switch (type) {
      case 'jobs': return Briefcase;
      case 'resources': return BookOpen;
      case 'announcements': return Megaphone;
    }
  };

  const getHeaderInfo = () => {
    switch (type) {
      case 'jobs':
        return {
          title: '📂 Jobs Management',
          subtitle: 'Manage all job postings from startups and colleges.',
          emptyMessage: '💼 No jobs posted yet. Encourage startups to add opportunities.'
        };
      case 'resources':
        return {
          title: '📚 Resources Management',
          subtitle: 'Curate learning resources for students.',
          emptyMessage: '📖 No resources available. Start adding content to help students learn.'
        };
      case 'announcements':
        return {
          title: '📢 Announcements Management',
          subtitle: 'Post and manage announcements for the entire platform.',
          emptyMessage: '📢 No announcements yet. Keep your community updated!'
        };
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform?.toLowerCase()) {
      case 'youtube': return Youtube;
      case 'pdf': return FileText;
      default: return Globe;
    }
  };

  const Icon = getIcon();
  const headerInfo = getHeaderInfo();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/4 mb-4"></div>
          <div className="h-10 bg-muted rounded mb-4"></div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{headerInfo.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{headerInfo.subtitle}</p>
        </div>
        <Button 
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 rounded-lg shadow-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add New
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder={`Search ${type}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 rounded-lg border-muted-foreground/20 shadow-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!items || items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-6xl mb-4">
                {type === 'jobs' ? '💼' : type === 'resources' ? '📖' : '📢'}
              </div>
              <p className="text-muted-foreground text-lg">{headerInfo.emptyMessage}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-muted-foreground/10">
                  {type === 'jobs' && (
                    <>
                      <TableHead className="font-semibold">Job Title</TableHead>
                      <TableHead className="font-semibold">Company</TableHead>
                      <TableHead className="font-semibold">Location</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </>
                  )}
                  {type === 'resources' && (
                    <>
                      <TableHead className="font-semibold">Title</TableHead>
                      <TableHead className="font-semibold">Category</TableHead>
                      <TableHead className="font-semibold">Platform</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </>
                  )}
                  {type === 'announcements' && (
                    <>
                      <TableHead className="font-semibold">Title</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items?.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/30 border-muted-foreground/10">
                    {type === 'jobs' && (
                      <>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {(item as any).logo_url && (
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={(item as any).logo_url} alt="Company logo" />
                                <AvatarFallback>{((item as any).company_name || '').charAt(0)}</AvatarFallback>
                              </Avatar>
                            )}
                            <div>
                              <div className="font-semibold text-foreground cursor-pointer hover:text-primary">
                                {(item as any).role}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {(item as any).logo_url && (
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={(item as any).logo_url} alt="Company logo" />
                                <AvatarFallback className="text-xs">{((item as any).company_name || '').charAt(0)}</AvatarFallback>
                              </Avatar>
                            )}
                            <span>{(item as any).company_name}</span>
                          </div>
                        </TableCell>
                        <TableCell>{(item as any).location}</TableCell>
                        <TableCell>{getStatusBadge(item)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(item.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => window.open((item as any).apply_link, "_blank")}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleItemAction(item, 'approve')}>
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Approve Job
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleItemAction(item, 'reject')}>
                                <XCircle className="mr-2 h-4 w-4" />
                                Reject Job
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleItemAction(item, 'delete')}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </>
                    )}
                    {type === 'resources' && (
                      <>
                        <TableCell>
                          <div className="font-semibold text-foreground cursor-pointer hover:text-primary">
                            {(item as any).title}
                          </div>
                        </TableCell>
                        <TableCell>{(item as any).category || 'General'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {React.createElement(getPlatformIcon((item as any).platform), { className: "h-4 w-4" })}
                            <span>{(item as any).platform}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(item)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(item.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => window.open((item as any).url, "_blank")}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Resource
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleItemAction(item, 'approve')}>
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleItemAction(item, 'reject')}>
                                <XCircle className="mr-2 h-4 w-4" />
                                Reject
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleItemAction(item, 'delete')}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </>
                    )}
                    {type === 'announcements' && (
                      <>
                        <TableCell>
                          <div className="font-semibold text-foreground">{(item as any).title}</div>
                        </TableCell>
                        <TableCell>{getStatusBadge(item)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(item.created_at).toLocaleDateString()}
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
                              <DropdownMenuItem>
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Publish
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <XCircle className="mr-2 h-4 w-4" />
                                Unpublish
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleItemAction(item, 'delete')}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New {type.slice(0, -1)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Title" />
            {type === 'announcements' && (
              <Textarea placeholder="Description" />
            )}
            {/* Add more fields as needed for each type */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setIsCreateModalOpen(false)}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription>
              Are you sure you want to {actionType} this {type.slice(0, -1)}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedItem(null)}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'delete' || actionType === 'reject' ? 'destructive' : 'default'}
              onClick={confirmAction}
              disabled={updateItemMutation.isPending}
            >
              {updateItemMutation.isPending ? 'Processing...' : `${actionType} ${type.slice(0, -1)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ContentManagement;