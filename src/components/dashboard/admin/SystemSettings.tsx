import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, Plus, Trash2, UserPlus } from "lucide-react";

const SystemSettings = () => {
  const [isCreateAdminModalOpen, setIsCreateAdminModalOpen] = useState(false);
  const [newAdminData, setNewAdminData] = useState({
    name: "",
    email: "",
    role: "admin"
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: adminUsers, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_users')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  const createAdminMutation = useMutation({
    mutationFn: async (adminData: { name: string; email: string; role: string }) => {
      const { data, error } = await supabase.functions.invoke(
        'create-admin-user',
        {
          body: {
            name: adminData.name.trim(),
            email: adminData.email.trim().toLowerCase(),
          },
        }
      );

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: "Success",
        description: "Admin account created and invitation sent.",
      });
      setIsCreateAdminModalOpen(false);
      setNewAdminData({ name: "", email: "", role: "admin" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create admin user: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const deleteAdminMutation = useMutation({
    mutationFn: async (adminId: string) => {
      const { error } = await (supabase.from('admin_users') as any)
        .update({ status: 'inactive' })
        .eq('id', adminId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: "Success",
        description: "Admin user deactivated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to deactivate admin user: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleCreateAdmin = () => {
    if (!newAdminData.name || !newAdminData.email) {
      toast({
        title: "Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    createAdminMutation.mutate(newAdminData);
  };

  // This used to label every row "Moderator" unless the role was "super" —
  // neither of which is a role that exists. It now shows what is actually
  // stored, so the table cannot claim somebody has access they do not have.
  const getRoleBadge = (role: string) => (
    <Badge variant="default">{role === 'admin' ? 'Administrator' : role}</Badge>
  );

  const getStatusBadge = (status: string) => {
    return (
      <Badge variant={status === 'active' ? 'default' : 'destructive'}>
        {status}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-6 w-6" />
          <h2 className="text-2xl font-bold">System Settings & Roles</h2>
        </div>
      </div>

      {/* Admin Users Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Admin Users</CardTitle>
            <Button onClick={() => setIsCreateAdminModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Admin
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adminUsers?.map((admin) => (
                <TableRow key={admin.id}>
                  <TableCell className="font-medium">{admin.name}</TableCell>
                  <TableCell>{admin.email}</TableCell>
                  <TableCell>{getRoleBadge(admin.role)}</TableCell>
                  <TableCell>{getStatusBadge(admin.status)}</TableCell>
                  <TableCell>
                    {new Date(admin.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {admin.status === 'active' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteAdminMutation.mutate(admin.id)}
                        disabled={deleteAdminMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* System Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>System Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="email-template">Email Template Settings</Label>
              <Button variant="outline" className="w-full mt-2">
                Configure Email Templates
              </Button>
            </div>
            <div>
              <Label htmlFor="notification-rules">Notification Rules</Label>
              <Button variant="outline" className="w-full mt-2">
                Manage Notification Rules
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create Admin Modal */}
      <Dialog open={isCreateAdminModalOpen} onOpenChange={setIsCreateAdminModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Create New Admin User
            </DialogTitle>
            <DialogDescription>
              Add a new administrator to manage the ProofLabAI platform.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="admin-name">Name</Label>
              <Input
                id="admin-name"
                value={newAdminData.name}
                onChange={(e) => setNewAdminData({ ...newAdminData, name: e.target.value })}
                placeholder="Enter admin name"
              />
            </div>
            <div>
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                value={newAdminData.email}
                onChange={(e) => setNewAdminData({ ...newAdminData, email: e.target.value })}
                placeholder="Enter admin email"
              />
            </div>
            <div>
              <Label htmlFor="admin-role">Role</Label>
              <Select
                value={newAdminData.role}
                onValueChange={(value) => setNewAdminData({ ...newAdminData, role: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
              {/* Moderator and Super Admin used to be offered here and neither
                  existed. There is one admin role, and it is all-or-nothing —
                  offering tiers that grant identical access is worse than
                  offering none, because somebody will believe them. */}
              <p className="text-xs text-muted-foreground mt-1.5">
                A new login will be created for this email and the administrator
                will receive a secure set-password invitation.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateAdminModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateAdmin}
              disabled={createAdminMutation.isPending}
            >
              {createAdminMutation.isPending ? 'Creating...' : 'Create Admin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SystemSettings;