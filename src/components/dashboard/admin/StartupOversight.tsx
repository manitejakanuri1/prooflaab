import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Building2, Eye, Edit, CheckCircle, Ban, Trash2, MoreHorizontal, Filter } from "lucide-react";

interface StartupData {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  user_id: string;
  verification_status?: string;
  last_active?: string;
  tasks_posted?: number;
}

const StartupOversight = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedStartup, setSelectedStartup] = useState<StartupData | null>(null);
  const [viewMode, setViewMode] = useState<'view' | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: startups, isLoading } = useQuery({
    queryKey: ['startup-oversight', searchTerm, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('startups')
        .select(`
          *,
          startup_profiles(startup_name)
        `);

      if (searchTerm) {
        query = query.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
      }

      if (statusFilter !== "all") {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      
      // Fetch additional data for each startup
      const startupsWithMetadata = await Promise.all(
        (data || []).map(async (startup: any) => {
          // Get tasks count
          const { count: tasksPosted } = await supabase
            .from('tasks')
            .select('id', { count: 'exact' })
            .eq('created_by_startup_id', startup.user_id);
          
          // Get last activity date from activity_logs
          const { data: activityData } = await supabase
            .from('activity_logs')
            .select('date')
            .eq('user_id', startup.user_id)
            .order('date', { ascending: false })
            .limit(1);

          // Get last task posted date
          const { data: taskData } = await supabase
            .from('tasks')
            .select('created_at')
            .eq('created_by_startup_id', startup.user_id)
            .order('created_at', { ascending: false })
            .limit(1);

          // Determine last active date (most recent between login and task posting)
          const lastLogin = activityData?.[0]?.date;
          const lastTaskPosted = taskData?.[0]?.created_at;
          
          let lastActive = startup.created_at; // fallback to creation date
          if (lastLogin && lastTaskPosted) {
            lastActive = new Date(lastLogin) > new Date(lastTaskPosted) ? lastLogin : lastTaskPosted;
          } else if (lastLogin) {
            lastActive = lastLogin;
          } else if (lastTaskPosted) {
            lastActive = lastTaskPosted;
          }
          
          return { 
            ...startup, 
            tasks_posted: tasksPosted || 0,
            last_active: lastActive,
            startup_name: Array.isArray(startup.startup_profiles) && startup.startup_profiles[0]?.startup_name 
              ? startup.startup_profiles[0].startup_name 
              : startup.name
          };
        })
      );
      
      return startupsWithMetadata;
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('startups')
        .update({ status: 'active' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-oversight'] });
      toast({
        title: "Success",
        description: "Startup approved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to approve startup: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const suspendMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('startups')
        .update({ status: 'suspended' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-oversight'] });
      toast({
        title: "Success",
        description: "Startup suspended successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to suspend startup: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('startups')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-oversight'] });
      toast({
        title: "Success",
        description: "Startup deleted successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete startup: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const openModal = (mode: 'view', startup: StartupData) => {
    setViewMode(mode);
    setSelectedStartup(startup);
  };

  const closeModal = () => {
    setViewMode(null);
    setSelectedStartup(null);
  };

  const handleApprove = (startup: StartupData) => {
    if (confirm(`Approve ${startup.name}? This will activate their account.`)) {
      approveMutation.mutate(startup.id);
    }
  };

  const handleSuspend = (startup: StartupData) => {
    if (confirm(`Suspend ${startup.name}? This will prevent them from accessing the platform.`)) {
      suspendMutation.mutate(startup.id);
    }
  };

  const handleDelete = (startup: StartupData) => {
    if (confirm(`Delete ${startup.name}? This action cannot be undone.`)) {
      deleteMutation.mutate(startup.id);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      active: { variant: "default" as const, className: "bg-green-100 text-green-800 hover:bg-green-100" },
      pending: { variant: "secondary" as const, className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
      suspended: { variant: "destructive" as const, className: "bg-red-100 text-red-800 hover:bg-red-100" }
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return (
      <Badge variant={config.variant} className={config.className}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const paginatedStartups = startups?.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil((startups?.length || 0) / itemsPerPage);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/3 mb-6"></div>
          <div className="h-10 bg-muted rounded mb-4"></div>
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Startup Management</h1>
            <p className="text-muted-foreground">Manage startup accounts and monitor their activity</p>
          </div>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40 pl-10">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-4 sm:ml-auto">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search startups..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-full sm:w-80"
                />
              </div>
              <Select value={itemsPerPage.toString()} onValueChange={(value) => setItemsPerPage(Number(value))}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold">Startup Name</TableHead>
                  <TableHead className="font-semibold hidden sm:table-cell">Email</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold hidden sm:table-cell">Created</TableHead>
                  <TableHead className="font-semibold hidden sm:table-cell">Last Active</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedStartups?.map((startup) => (
                  <TableRow key={startup.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <span className="truncate">{(startup as any).startup_name || startup.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      <span className="truncate block max-w-48">{startup.email}</span>
                    </TableCell>
                    <TableCell>{getStatusBadge(startup.status)}</TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      {new Date(startup.created_at).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      {(startup as any).last_active ? new Date((startup as any).last_active).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      }) : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openModal('view', startup)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {startup.status === 'pending' && (
                            <DropdownMenuItem onClick={() => handleApprove(startup)} className="text-green-600">
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Approve
                            </DropdownMenuItem>
                          )}
                          {startup.status === 'active' && (
                            <DropdownMenuItem 
                              onClick={() => handleSuspend(startup)}
                              className="text-orange-600"
                            >
                              <Ban className="h-4 w-4 mr-2" />
                              Suspend
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem 
                            onClick={() => handleDelete(startup)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, startups?.length || 0)} of {startups?.length || 0} startups
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm px-3 py-1 bg-muted rounded">
                  {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Details Modal */}
      <Dialog open={viewMode === 'view'} onOpenChange={closeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Startup Details</DialogTitle>
            <DialogDescription>
              View startup profile and account information
            </DialogDescription>
          </DialogHeader>
          {selectedStartup && (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">{(selectedStartup as any).startup_name || selectedStartup.name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedStartup.email}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <div className="mt-1">{getStatusBadge(selectedStartup.status)}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Created</label>
                  <p className="text-sm mt-1">
                    {new Date(selectedStartup.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Last Active</label>
                  <p className="text-sm mt-1">
                    {selectedStartup.last_active ? new Date(selectedStartup.last_active).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long', 
                      day: 'numeric'
                    }) : 'Never'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Tasks Posted</label>
                  <p className="text-sm mt-1 font-mono">{(selectedStartup as any).tasks_posted || 0}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StartupOversight;