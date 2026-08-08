import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { 
  Search, Users, Building2, Rocket, Ban, CheckCircle, AlertTriangle, 
  Eye, Download, MoreHorizontal, Shield, Trash2, UserX, UserCheck
} from "lucide-react";

interface UserManagementProps {
  type: 'students' | 'startups' | 'colleges';
}

const UserManagement = ({ type }: UserManagementProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [actionType, setActionType] = useState<'block' | 'unblock' | 'approve' | 'suspend'>('block');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: [`admin-${type}`, searchTerm],
    queryFn: async () => {
      // The table is chosen at runtime, which is more than the generated
      // types can follow, hence the any.
      let query: any = supabase
        .from(type === 'students' ? 'student_profiles' : type)
        .select(type === 'students' ? '*, student_contact (email)' : '*');

      if (searchTerm) {
        if (type === 'students') {
          // email lives in student_contact now, so students match on name.
          query = query.ilike('full_name', `%${searchTerm}%`);
        } else {
          query = query.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
        }
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      const table = type === 'students' ? 'student_profiles' : type;
      const { error } = await supabase
        .from(table)
        .update(updates)
        .eq('id', userId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin-${type}`] });
      toast({
        title: "Success",
        description: `User ${actionType}ed successfully.`,
      });
      setSelectedUser(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to ${actionType} user: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleUserAction = (user: any, action: 'block' | 'unblock' | 'approve' | 'suspend') => {
    setSelectedUser(user);
    setActionType(action);
  };

  const confirmAction = () => {
    if (!selectedUser) return;

    const updates: any = {};
    
    if (type === 'students') {
      updates.status = actionType === 'block' ? 'blocked' : 'active';
    } else {
      if (actionType === 'approve') {
        updates.verification_status = 'approved';
      } else if (actionType === 'suspend') {
        updates.verification_status = 'suspended';
      }
    }

    updateUserMutation.mutate({
      userId: selectedUser.id,
      updates
    });
  };

  const getStatusBadge = (user: any) => {
    if (type === 'students') {
      const status = user.status || 'active';
      return (
        <Badge variant={status === 'active' ? 'default' : 'destructive'}>
          {status}
        </Badge>
      );
    } else {
      const status = (user as any).verification_status || 'pending';
      return (
        <Badge variant={
          status === 'approved' ? 'default' : 
          status === 'suspended' ? 'destructive' : 'secondary'
        }>
          {status}
        </Badge>
      );
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'students': return Users;
      case 'startups': return Rocket;
      case 'colleges': return Building2;
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
                <TableHead>{type === 'students' ? 'Name' : 'Name'}</TableHead>
                <TableHead>Email</TableHead>
                {type === 'students' && (
                  <>
                    <TableHead>Trust Score</TableHead>
                    <TableHead>XP</TableHead>
                  </>
                )}
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {type === 'students' ? (user as any).full_name : (user as any).name}
                  </TableCell>
                  <TableCell>
                    {(user as any).student_contact?.email ?? (user as any).email}
                  </TableCell>
                  {type === 'students' && (
                    <>
                      <TableCell>{(user as any).trust_score || 0}</TableCell>
                      <TableCell>{(user as any).total_xp || 0}</TableCell>
                    </>
                  )}
                  <TableCell>{getStatusBadge(user)}</TableCell>
                  <TableCell>
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      {type === 'students' ? (
                        <>
                          {user.status !== 'blocked' ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleUserAction(user, 'block')}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleUserAction(user, 'unblock')}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          {(user as any).verification_status !== 'approved' && (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleUserAction(user, 'approve')}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {(user as any).verification_status !== 'suspended' && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleUserAction(user, 'suspend')}
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription>
              Are you sure you want to {actionType} this {type.slice(0, -1)}? This action will change their access permissions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedUser(null)}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'block' || actionType === 'suspend' ? 'destructive' : 'default'}
              onClick={confirmAction}
              disabled={updateUserMutation.isPending}
            >
              {updateUserMutation.isPending ? 'Processing...' : `${actionType} User`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;