import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { 
  Search, 
  School, 
  Plus, 
  Eye, 
  Edit, 
  Pause, 
  MoreHorizontal, 
  CheckCircle,
  ArrowUpDown,
  Trash2,
  UserMinus,
} from "lucide-react";
import { removalSummary, removeStudents } from "@/lib/removeStudents";
import { useConfirm } from "@/hooks/useConfirm";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { readFunctionError } from "@/lib/functionError";

// Students removed per call to accounts /remove. 200 took over the gateway's 60 s limit on staging (13 Oct).
const REMOVE_BATCH = 25;
// How often the page re-reads the database while it is open.
const LIVE_MS = 10_000;

const CollegeOversight = () => {
  const [progress, setProgress] = useState<{ name: string; done: number; total: number } | null>(null);
  const [confirmBox, ask] = useConfirm();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<'created_at' | 'students_count' | 'last_active'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedCollege, setSelectedCollege] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'view' | 'edit' | 'add' | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    status: 'pending'
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: colleges, isLoading, error: queryError, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['college-oversight', searchTerm, statusFilter, sortBy, sortOrder],
    queryFn: async () => {
      
      try {
        // First, get basic college data
        let baseQuery = supabase
          .from('colleges')
          .select('*');

        if (searchTerm) {
          baseQuery = baseQuery.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
        }

        if (statusFilter !== 'all') {
          baseQuery = baseQuery.eq('status', statusFilter);
        }

        const { data: collegeData, error: collegeError } = await baseQuery;
        if (collegeError) {
          console.error('College query error:', collegeError);
          throw collegeError;
        }
        

        if (!collegeData || collegeData.length === 0) {
          return [];
        }

        // Exact counts from the database (13 Oct). These used to download every student and task row and count
        // them in the browser, which the API cuts off, so a big college showed a wrong number.
        const counted = ({ count, error }: { count: number | null; error: unknown }) => {
          if (error) console.error('count error:', error);
          return count ?? 0;
        };
        const processedColleges = await Promise.all(collegeData.map(async (college) => ({
          ...college,
          students_count: counted(await supabase.from('student_profiles')
            .select('id', { count: 'exact', head: true }).eq('college_id', college.id)),
          tasks_assigned: counted(await supabase.from('tasks')
            .select('id', { count: 'exact', head: true }).eq('created_by_college_id', college.id)),
        })));

        // Sort data
        processedColleges.sort((a, b) => {
          let aValue, bValue;
          
          switch (sortBy) {
            case 'students_count':
              aValue = a.students_count;
              bValue = b.students_count;
              break;
            case 'last_active':
              aValue = a.last_active ? new Date(a.last_active).getTime() : 0;
              bValue = b.last_active ? new Date(b.last_active).getTime() : 0;
              break;
            default:
              aValue = new Date(a.created_at).getTime();
              bValue = new Date(b.created_at).getTime();
          }
          
          return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
        });

        return processedColleges;
        
      } catch (error) {
        console.error('Query function error:', error);
        throw error;
      }
    }
  });

  // Live numbers: re-read every 10 s while the tab is visible, and at once when it is looked at again.
  useLiveRefresh(() => { void refetch(); }, LIVE_MS);

  // Log any query errors
  if (queryError) {
    console.error('Query error:', queryError);
  }

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // A college needs a real sign-in account, which the browser can't
      // create on its own — that needs the service-role key, server-side.
      // This used to insert a fake 'temp-user-id' string directly, which
      // isn't a valid uuid; it failed every time rather than creating a
      // college. create-college-user does this properly: real account,
      // college_admin role, and an invite email with a working sign-in link.
      const { data: result, error } = await supabase.functions.invoke('create-college-user', {
        body: { name: data.name, email: data.email, status: data.status },
      });
      if (error) throw new Error(String((await readFunctionError(error))?.error ?? error.message));
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['college-oversight'] });
      toast({
        title: "College account created",
        description: result?.invited
          ? "Set-password invitation sent."
          : "Account created, but invitation delivery was not confirmed. Ask the college administrator to use Forgot password on the sign-in page.",
        variant: result?.invited ? undefined : "destructive",
      });
      closeModal();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to add college: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const { error } = await supabase
        .from('colleges')
        .update(data)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['college-oversight'] });
      toast({
        title: "Success",
        description: "College updated successfully.",
      });
      closeModal();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update college: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const suspendMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('colleges')
        .update({ status: 'suspended' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['college-oversight'] });
      toast({
        title: "Success",
        description: "College suspended successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to suspend college: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('colleges')
        .update({
          status: 'active',
          verification_status: 'approved'
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['college-oversight'] });
      toast({
        title: "Success",
        description: "College approved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to approve college: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Reject (kept from the old Colleges list): the college is turned down; its admin cannot sign in.
  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('colleges').update({ verification_status: 'rejected' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['college-oversight'] });
      toast({ title: "College rejected" });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to reject college: ${error.message}`, variant: "destructive" });
    }
  });

  const openModal = (mode: 'view' | 'edit' | 'add', college?: any) => {
    setViewMode(mode);
    setSelectedCollege(college);
    if (college) {
      setFormData({
        name: college.name || '',
        email: college.email || '',
        status: college.status || 'pending'
      });
    } else {
      setFormData({ name: '', email: '', status: 'pending' });
    }
  };

  const closeModal = () => {
    setViewMode(null);
    setSelectedCollege(null);
    setFormData({ name: '', email: '', status: 'pending' });
  };

  const handleSave = () => {
    if (viewMode === 'add') {
      createMutation.mutate(formData);
    } else if (viewMode === 'edit' && selectedCollege) {
      updateMutation.mutate({ id: selectedCollege.id, data: formData });
    }
  };

  const handleSuspend = (college: any) => {
    if (confirm(`Suspend ${college.name}? This will prevent them from accessing the platform.`)) {
      suspendMutation.mutate(college.id);
    }
  };

  const handleApprove = (college: any) => {
    if (confirm(`Approve ${college.name}? This will activate their account.`)) {
      approveMutation.mutate(college.id);
    }
  };

  // Exact count at click time: the table's count reads rows and can be cut short on a very big college.
  const countStudents = async (collegeId: string) => {
    const { count, error } = await supabase.from('student_profiles')
      .select('id', { count: 'exact', head: true }).eq('college_id', collegeId);
    if (error) throw error;
    return count ?? 0;
  };

  // Every student of one college, through the same removal as one student (accounts /remove), in batches.
  const handleRemoveAll = async (college: any) => {
    try {
      const total = await countStudents(college.id);
      if (!total) { toast({ title: `${college.name} has no students` }); return; }
      if (!(await ask({
        title: `Remove all ${total.toLocaleString("en-IN")} students of ${college.name}?`,
        points: ["Their work, scores and logins are deleted", "Locked test accounts are skipped", "Keep this page open until it finishes"],
        action: "Remove all",
      }))) return;
      let removed = 0;
      let keptProtected = 0;
      setProgress({ name: college.name, done: 0, total });
      for (;;) {
        // Locked test accounts never leave the list, so each batch skips the ones already found.
        const { data, error } = await supabase.from('student_profiles').select('id')
          .eq('college_id', college.id).range(keptProtected, keptProtected + REMOVE_BATCH - 1).order('id');
        if (error) throw error;
        const ids = (data ?? []).map((r) => r.id as string);
        if (!ids.length) break;
        const r = await removeStudents(ids);
        if (r.removed === 0 && r.keptProtected === 0) throw new Error("the server removed nobody in the last batch; stopped");
        removed += r.removed;
        keptProtected += r.keptProtected;
        setProgress({ name: college.name, done: removed, total });
        void refetch();   // the table's count drops live, batch by batch
      }
      toast({ title: `${college.name}: ${removalSummary({ removed, keptProtected })}` });
    } catch (e) {
      toast({ title: "Stopped", description: (e as Error).message, variant: "destructive" });
    } finally {
      setProgress(null);
      void queryClient.invalidateQueries();
    }
  };

  // Only an empty college can be deleted. Its admin then cannot sign in (no college -> refused at login).
  const handleDeleteCollege = async (college: any) => {
    try {
      const total = await countStudents(college.id);
      if (total) {
        toast({ title: "Not deleted", description: `${college.name} still has ${total} students. Remove them first.`, variant: "destructive" });
        return;
      }
      if (!(await ask({
        title: `Delete "${college.name}"?`,
        points: ["Its squads, seasons and imports are deleted too", "Its admin can no longer sign in"],
        action: "Delete",
      }))) return;
      // Server side (delete-college): the college, then its admin's role and login, so the email can be reused.
      const { data, error } = await supabase.functions.invoke('delete-college', { body: { college_id: college.id } });
      if (error) throw new Error(String((await readFunctionError(error))?.error ?? error.message));
      toast({
        title: `Deleted ${college.name}`,
        description: data?.login_deleted ? "Its admin's login was deleted too." : (data?.note ?? undefined),
      });
      void queryClient.invalidateQueries({ queryKey: ['college-oversight'] });
    } catch (e) {
      toast({ title: "Not deleted", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleReject = (college: any) => {
    if (confirm(`Reject ${college.name}? Its admin will not be able to sign in.`)) {
      rejectMutation.mutate(college.id);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: any; className: string }> = {
      active: { variant: 'default', className: 'bg-green-100 text-green-800 border-green-200' },
      pending: { variant: 'secondary', className: 'bg-orange-100 text-orange-800 border-orange-200' },
      suspended: { variant: 'destructive', className: 'bg-red-100 text-red-800 border-red-200' }
    };
    
    const config = statusConfig[status] || statusConfig.pending;
    return (
      <Badge variant={config.variant} className={config.className}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const handleSort = (column: 'created_at' | 'students_count' | 'last_active') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const paginatedColleges = colleges?.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil((colleges?.length || 0) / itemsPerPage);

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
      {confirmBox}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <School className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Colleges</h1>
            <p className="text-muted-foreground">
              Manage college accounts and activities · Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-GB') : '—'}
              <Button variant="link" size="sm" className="h-auto px-2" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? 'Refreshing…' : 'Refresh'}
              </Button>
            </p>
          </div>
        </div>
        <Button onClick={() => openModal('add')} className="gap-2">
          <Plus className="h-4 w-4" />
          Add New College
        </Button>
      </div>

      {progress && (
        <div role="status" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          Removing students of <b>{progress.name}</b>: {progress.done} of {progress.total}. Keep this page open.
        </div>
      )}

      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-1 max-w-md w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search college..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
              <Select value={itemsPerPage.toString()} onValueChange={(value) => setItemsPerPage(Number(value))}>
                <SelectTrigger className="w-full sm:w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
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
                  <TableHead className="font-semibold">Name</TableHead>
                  <TableHead className="font-semibold hidden sm:table-cell">Email</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead 
                    className="font-semibold cursor-pointer hover:bg-muted/50 hidden lg:table-cell"
                    onClick={() => handleSort('last_active')}
                  >
                    <div className="flex items-center gap-1">
                      Last Active
                      <ArrowUpDown className="h-4 w-4" />
                    </div>
                  </TableHead>
                  <TableHead 
                    className="font-semibold cursor-pointer hover:bg-muted/50 hidden md:table-cell"
                    onClick={() => handleSort('students_count')}
                  >
                    <div className="flex items-center gap-1">
                      Students Count
                      <ArrowUpDown className="h-4 w-4" />
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold hidden xl:table-cell">Tasks Assigned</TableHead>
                  <TableHead 
                    className="font-semibold cursor-pointer hover:bg-muted/50 hidden lg:table-cell"
                    onClick={() => handleSort('created_at')}
                  >
                    <div className="flex items-center gap-1">
                      Created
                      <ArrowUpDown className="h-4 w-4" />
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedColleges?.map((college) => (
                  <TableRow key={college.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">{college.name}</TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">{college.email}</TableCell>
                    <TableCell>
                      {getStatusBadge(college.status)}
                      {college.verification_status === 'rejected' && (
                        <Badge variant="destructive" className="ml-1">rejected</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden lg:table-cell">
                      {college.last_active 
                        ? new Date(college.last_active).toLocaleDateString('en-GB')
                        : "—"
                      }
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className="font-mono">
                        {college.students_count}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <Badge variant="outline" className="font-mono">
                        {college.tasks_assigned}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden lg:table-cell">
                      {new Date(college.created_at).toLocaleDateString('en-GB')}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-background border shadow-lg">
                          <DropdownMenuItem onClick={() => openModal('view', college)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {(college.status !== 'active' || college.verification_status !== 'approved') && (
                            <DropdownMenuItem onClick={() => handleApprove(college)}>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              {college.status === 'suspended' ? 'Reactivate' : 'Approve'}
                            </DropdownMenuItem>
                          )}
                          {college.verification_status !== 'approved' && college.verification_status !== 'rejected' && (
                            <DropdownMenuItem onClick={() => handleReject(college)} className="text-destructive">
                              <Pause className="h-4 w-4 mr-2" />
                              Reject
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openModal('edit', college)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          {college.status !== 'suspended' && (
                            <DropdownMenuItem
                              onClick={() => handleSuspend(college)}
                              className="text-orange-600"
                            >
                              <Pause className="h-4 w-4 mr-2" />
                              Suspend
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem disabled={!!progress} onClick={() => void handleRemoveAll(college)} className="text-destructive">
                            <UserMinus className="h-4 w-4 mr-2" />
                            Remove all students
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={!!progress} onClick={() => void handleDeleteCollege(college)} className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete college
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
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, colleges?.length || 0)} of {colleges?.length || 0} colleges
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

      {/* Enhanced Modal */}
      <Dialog open={!!viewMode} onOpenChange={closeModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {viewMode === 'add' ? 'Add New College' : 
               viewMode === 'edit' ? 'Edit College' : 'College Profile'}
            </DialogTitle>
            <DialogDescription>
              {viewMode === 'view' ? 'Comprehensive college information and statistics' : 
               viewMode === 'add' ? 'Add a new college to the platform' : 
               'Update college information'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Name</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={viewMode === 'view'}
                placeholder="College name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Email</label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={viewMode === 'view'}
                placeholder="College admin email"
              />
            </div>
            {viewMode === 'view' && selectedCollege && (
              <>
                <div>
                  <label className="text-sm font-medium mb-2 block">Status</label>
                  <div>{getStatusBadge(selectedCollege.status)}</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Students Count</label>
                    <Badge variant="outline" className="font-mono text-base">
                      {selectedCollege.students_count || 0}
                    </Badge>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Tasks Assigned</label>
                    <Badge variant="outline" className="font-mono text-base">
                      {selectedCollege.tasks_assigned || 0}
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Created Date</label>
                    <p className="text-sm text-muted-foreground">
                      {new Date(selectedCollege.created_at).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Last Active</label>
                    <p className="text-sm text-muted-foreground">
                      {selectedCollege.last_active 
                        ? new Date(selectedCollege.last_active).toLocaleDateString('en-GB')
                        : "—"
                      }
                    </p>
                  </div>
                </div>
              </>
            )}
            {viewMode !== 'view' && (
              <div>
                <label className="text-sm font-medium mb-2 block">Status</label>
                <Select 
                  value={formData.status} 
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              {viewMode === 'view' ? 'Close' : 'Cancel'}
            </Button>
            {viewMode !== 'view' && (
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CollegeOversight;