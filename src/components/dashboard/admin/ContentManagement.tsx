import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Search, Plus, Briefcase, BookOpen, Megaphone, Edit, Trash2, CheckCircle, X } from "lucide-react";

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
    const status = (item as any).status || 'approved';
    return (
      <Badge variant={
        status === 'approved' ? 'default' :
        status === 'rejected' ? 'destructive' : 'secondary'
      }>
        {status}
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

  const Icon = getIcon();

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-6 w-6" />
          <h2 className="text-2xl font-bold capitalize">{type} Management</h2>
        </div>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add {type.slice(0, -1)}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder={`Search ${type}...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                {type === 'jobs' && (
                  <>
                    <TableHead>Company</TableHead>
                    <TableHead>Location</TableHead>
                  </>
                )}
                {type === 'resources' && (
                  <>
                    <TableHead>Category</TableHead>
                    <TableHead>Platform</TableHead>
                  </>
                )}
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{(item as any).title || (item as any).role}</TableCell>
                  {type === 'jobs' && (
                    <>
                      <TableCell>{(item as any).company_name}</TableCell>
                      <TableCell>{(item as any).location}</TableCell>
                    </>
                  )}
                  {type === 'resources' && (
                    <>
                      <TableCell>{(item as any).category}</TableCell>
                      <TableCell>{(item as any).platform}</TableCell>
                    </>
                  )}
                  <TableCell>{getStatusBadge(item)}</TableCell>
                  <TableCell>
                    {new Date(item.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      {item.status !== 'approved' && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleItemAction(item, 'approve')}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                      {item.status !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleItemAction(item, 'reject')}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleItemAction(item, 'delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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