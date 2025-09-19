import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Search, Users, Building2, Rocket, Ban, CheckCircle, AlertTriangle, 
  Eye, Download, MoreHorizontal, Shield, Trash2, UserX, UserCheck, Filter
} from "lucide-react";

interface UserData {
  id: string;
  email: string;
  created_at: string;
  status?: string;
  verification_status?: string;
  full_name?: string;
  name?: string;
  trust_score?: number;
  total_xp?: number;
  source?: string;
  college_id?: string;
  last_active?: string;
  college_name?: string;
  proofs_submitted?: number;
  student_count?: number;
  tasks_assigned?: number;
}

interface EnhancedUserManagementProps {
  initialTab?: string;
}

const EnhancedUserManagement = ({ initialTab = "students" }: EnhancedUserManagementProps) => {
  const { userType } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [collegeFilter, setCollegeFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [viewUserSheet, setViewUserSheet] = useState<UserData | null>(null);
  const [actionType, setActionType] = useState<'block' | 'unblock' | 'approve' | 'suspend' | 'delete'>('block');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Update activeTab based on URL params or initialTab
  useEffect(() => {
    if (userType && ['students', 'startups', 'colleges'].includes(userType)) {
      setActiveTab(userType);
    } else {
      setActiveTab(initialTab);
    }
  }, [userType, initialTab]);

  // Handle tab changes and navigate to appropriate URL
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    navigate(`/admin/dashboard/user-management/${newTab}`);
  };

  const { data: users, isLoading } = useQuery({
    queryKey: [`admin-users-${activeTab}`, searchTerm, statusFilter, sourceFilter, collegeFilter],
    queryFn: async () => {
      if (activeTab === 'students') {
        // For students, we need to join with colleges and count proofs
        let query = supabase
          .from('student_profiles')
          .select(`
            *,
            colleges!student_profiles_college_id_fkey(name),
            proof_uploads(count)
          `);

        if (searchTerm) {
          query = query.or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
        }

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter);
        }

        if (sourceFilter !== 'all') {
          query = query.eq('source', sourceFilter);
        }

        if (collegeFilter !== 'all') {
          query = query.eq('college_id', collegeFilter);
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        // Transform data to include college name and proofs count
        return (data as any[])?.map(student => ({
          ...student,
          college_name: student.colleges?.name || null,
          proofs_submitted: student.proof_uploads?.length || 0
        })) as UserData[];
      } else {
        // For startups and colleges
        let query;
        
        if (activeTab === 'startups') {
          query = supabase.from('startups').select('*');
        } else {
          // For colleges, get college data with student counts and task counts
          query = supabase.from('colleges').select(`
            *,
            student_profiles!college_id(count),
            tasks!created_by_college_id(count)
          `);
        }

        if (searchTerm) {
          query = query.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
        }

        if (statusFilter !== 'all') {
          query = query.eq('verification_status', statusFilter);
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        
        if (activeTab === 'colleges') {
          // Transform colleges data to include student and task counts
          return (data as any[])?.map(college => ({
            ...college,
            student_count: college.student_profiles?.[0]?.count || 0,
            tasks_assigned: college.tasks?.[0]?.count || 0
          })) as UserData[];
        }
        
        return data as UserData[];
      }
    }
  });

  // Fetch colleges for the college filter dropdown
  const { data: colleges } = useQuery({
    queryKey: ['colleges-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('colleges')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: activeTab === 'students'
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      let error;
      
      if (activeTab === 'students') {
        const result = await supabase
          .from('student_profiles')
          .update(updates)
          .eq('id', userId);
        error = result.error;
      } else if (activeTab === 'startups') {
        const result = await supabase
          .from('startups')
          .update(updates)
          .eq('id', userId);
        error = result.error;
      } else {
        const result = await supabase
          .from('colleges')
          .update(updates)
          .eq('id', userId);
        error = result.error;
      }
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin-users-${activeTab}`] });
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

  const handleUserAction = (user: UserData, action: typeof actionType) => {
    setSelectedUser(user);
    setActionType(action);
  };

  const confirmAction = () => {
    if (!selectedUser) return;

    let updates: any = {};
    
    if (activeTab === 'students') {
      if (actionType === 'block') updates.status = 'blocked';
      if (actionType === 'unblock') updates.status = 'active';
      if (actionType === 'delete') updates.status = 'deleted';
    } else {
      if (actionType === 'approve') updates.verification_status = 'approved';
      if (actionType === 'suspend') updates.verification_status = 'suspended';
      if (actionType === 'delete') updates.verification_status = 'deleted';
    }

    updateUserMutation.mutate({
      userId: selectedUser.id,
      updates
    });
  };

  const getStatusBadge = (user: UserData) => {
    if (activeTab === 'students') {
      const status = user.status || 'active';
      return (
        <Badge variant={
          status === 'active' ? 'default' : 
          status === 'blocked' ? 'destructive' : 'secondary'
        }>
          {status}
        </Badge>
      );
    } else {
      const status = user.verification_status || 'pending';
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

  const exportToCSV = () => {
    if (!users) return;
    
    const headers = activeTab === 'students' 
      ? ['Name', 'Email', 'Source', 'College', 'Trust Score', 'XP', 'Proofs Submitted', 'Last Active', 'Status', 'Created']
      : ['Name', 'Email', 'Status', 'Created'];
    
    const csvContent = [
      headers.join(','),
      ...users.map(user => [
        activeTab === 'students' ? user.full_name : user.name,
        user.email,
        ...(activeTab === 'students' ? [
          user.source || 'Website',
          user.college_name || 'N/A',
          user.trust_score || 0, 
          user.total_xp || 0,
          user.proofs_submitted || 0,
          user.last_active ? new Date(user.last_active).toLocaleDateString() : 'Never'
        ] : []),
        activeTab === 'students' ? user.status : user.verification_status,
        new Date(user.created_at).toLocaleDateString()
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `${activeTab}-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case 'students': return <Users className="h-4 w-4" />;
      case 'startups': return <Rocket className="h-4 w-4" />;
      case 'colleges': return <Building2 className="h-4 w-4" />;
      default: return null;
    }
  };

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
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Management
          </h1>
          <p className="text-muted-foreground">
            Manage {activeTab === 'students' ? 'students' : activeTab === 'startups' ? 'startups' : 'colleges'} accounts and settings
          </p>
        </div>
        <Button onClick={exportToCSV} variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="students" className="flex items-center gap-2 text-sm">
            {getTabIcon('students')}
            <span className="hidden sm:inline">Students</span>
            <span className="sm:hidden">Students</span>
          </TabsTrigger>
          <TabsTrigger value="startups" className="flex items-center gap-2 text-sm">
            {getTabIcon('startups')}
            <span className="hidden sm:inline">Startups</span>
            <span className="sm:hidden">Startups</span>
          </TabsTrigger>
          <TabsTrigger value="colleges" className="flex items-center gap-2 text-sm">
            {getTabIcon('colleges')}
            <span className="hidden sm:inline">Colleges</span>
            <span className="sm:hidden">Colleges</span>
          </TabsTrigger>
        </TabsList>

        {['students', 'startups', 'colleges'].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    {getTabIcon(tab)}
                    {tab.charAt(0).toUpperCase() + tab.slice(1)} Management
                  </CardTitle>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
                    <div className="relative w-full sm:w-auto">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                      <Input
                        placeholder={`Search ${tab}...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-full sm:w-64"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-32">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background border shadow-md z-50">
                          <SelectItem value="all">All Status</SelectItem>
                          {tab === 'students' ? (
                            <>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="blocked">Blocked</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="approved">Approved</SelectItem>
                              <SelectItem value="suspended">Suspended</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                      
                      {tab === 'students' && (
                        <>
                          <Select value={sourceFilter} onValueChange={setSourceFilter}>
                            <SelectTrigger className="w-32">
                              <Filter className="h-4 w-4 mr-2" />
                              <SelectValue placeholder="Source" />
                            </SelectTrigger>
                            <SelectContent className="bg-background border shadow-md z-50">
                              <SelectItem value="all">All Sources</SelectItem>
                              <SelectItem value="Website">Website</SelectItem>
                              <SelectItem value="College">College</SelectItem>
                            </SelectContent>
                          </Select>
                          
                          {sourceFilter === 'College' && colleges && colleges.length > 0 && (
                            <Select value={collegeFilter} onValueChange={setCollegeFilter}>
                              <SelectTrigger className="w-40">
                                <Filter className="h-4 w-4 mr-2" />
                                <SelectValue placeholder="College" />
                              </SelectTrigger>
                              <SelectContent className="bg-background border shadow-md z-50">
                                <SelectItem value="all">All Colleges</SelectItem>
                                {colleges.map((college) => (
                                  <SelectItem key={college.id} value={college.id}>
                                    {college.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      {tab === 'students' && (
                        <>
                          <TableHead>Source</TableHead>
                          <TableHead>Trust Score</TableHead>
                          <TableHead>XP</TableHead>
                          <TableHead>Proofs</TableHead>
                          <TableHead>Last Active</TableHead>
                        </>
                      )}
                      {tab === 'startups' && (
                        <>
                          <TableHead className="hidden md:table-cell">Last Active</TableHead>
                        </>
                      )}
                      {tab === 'colleges' && (
                        <>
                          <TableHead className="hidden md:table-cell">Last Active</TableHead>
                          <TableHead className="hidden md:table-cell">Students Count</TableHead>
                          <TableHead className="hidden lg:table-cell">Tasks Assigned</TableHead>
                        </>
                      )}
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                    <TableBody>
                      {users?.map((user) => (
                        <TableRow key={user.id} className="hover:bg-muted/30">
                          <TableCell className="font-medium">
                            {tab === 'students' ? user.full_name : user.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground hidden sm:table-cell">
                            <span className="truncate block max-w-48">{user.email}</span>
                          </TableCell>
                          {tab === 'students' && (
                            <>
                              <TableCell className="hidden md:table-cell">
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">
                                    {user.source || 'Website'}
                                  </span>
                                  {user.source === 'College' && user.college_name && (
                                    <span className="text-xs text-muted-foreground">
                                      {user.college_name}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center hidden lg:table-cell">
                                <Badge variant="outline">{user.trust_score || 0}</Badge>
                              </TableCell>
                              <TableCell className="text-center hidden lg:table-cell">
                                <Badge variant="secondary">{user.total_xp || 0}</Badge>
                              </TableCell>
                              <TableCell className="text-center hidden xl:table-cell">
                                <Badge variant="outline">{user.proofs_submitted || 0}</Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                                {user.last_active 
                                  ? new Date(user.last_active).toLocaleDateString('en-US', {
                                    month: 'numeric',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })
                                  : '—'
                                }
                              </TableCell>
                            </>
                          )}
                          {tab === 'startups' && (
                            <>
                              <TableCell className="text-muted-foreground hidden md:table-cell">
                                {user.last_active 
                                  ? new Date(user.last_active).toLocaleDateString('en-US', {
                                    month: 'numeric',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })
                                  : '—'
                                }
                              </TableCell>
                            </>
                          )}
                          {tab === 'colleges' && (
                            <>
                              <TableCell className="text-muted-foreground hidden md:table-cell">
                                {user.last_active 
                                  ? new Date(user.last_active).toLocaleDateString('en-US', {
                                    month: 'numeric',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })
                                  : '—'
                                }
                              </TableCell>
                              <TableCell className="text-center hidden md:table-cell">
                                <Badge variant="secondary">{user.student_count || 0}</Badge>
                              </TableCell>
                              <TableCell className="text-center hidden lg:table-cell">
                                <Badge variant="outline">{user.tasks_assigned || 0}</Badge>
                              </TableCell>
                            </>
                          )}
                           <TableCell>{getStatusBadge(user)}</TableCell>
                           <TableCell className="text-sm text-muted-foreground">
                             {new Date(user.created_at).toLocaleDateString('en-US', {
                               month: 'numeric',
                               day: 'numeric',
                               year: 'numeric'
                             })}
                           </TableCell>
                           <TableCell className="text-right">
                           <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-background border shadow-md z-50">
                              <DropdownMenuItem onClick={() => setViewUserSheet(user)}>
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              {tab === 'students' ? (
                                <>
                                  {user.status !== 'blocked' && (
                                    <DropdownMenuItem
                                      onClick={() => handleUserAction(user, 'block')}
                                      className="text-red-600"
                                    >
                                      <Ban className="h-4 w-4 mr-2" />
                                      Block User
                                    </DropdownMenuItem>
                                  )}
                                  {user.status === 'blocked' && (
                                    <DropdownMenuItem
                                      onClick={() => handleUserAction(user, 'unblock')}
                                      className="text-green-600"
                                    >
                                      <UserCheck className="h-4 w-4 mr-2" />
                                      Unblock User
                                    </DropdownMenuItem>
                                  )}
                                </>
                              ) : (
                                <>
                                  {user.verification_status !== 'approved' && (
                                    <DropdownMenuItem
                                      onClick={() => handleUserAction(user, 'approve')}
                                      className="text-green-600"
                                    >
                                      <CheckCircle className="h-4 w-4 mr-2" />
                                      Approve
                                    </DropdownMenuItem>
                                  )}
                                  {user.verification_status !== 'suspended' && (
                                    <DropdownMenuItem
                                      onClick={() => handleUserAction(user, 'suspend')}
                                      className="text-yellow-600"
                                    >
                                      <AlertTriangle className="h-4 w-4 mr-2" />
                                      Suspend
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                              <DropdownMenuItem
                                onClick={() => handleUserAction(user, 'delete')}
                                className="text-red-600"
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
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* User Details Sheet */}
      <Sheet open={!!viewUserSheet} onOpenChange={() => setViewUserSheet(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>User Details</SheetTitle>
            <SheetDescription>
              View comprehensive information about this {activeTab.slice(0, -1)}
            </SheetDescription>
          </SheetHeader>
          {viewUserSheet && (
            <div className="space-y-4 mt-6">
              <div>
                <h4 className="font-semibold">Basic Information</h4>
                <div className="space-y-2 mt-2">
                  <p><strong>Name:</strong> {activeTab === 'students' ? viewUserSheet.full_name : viewUserSheet.name}</p>
                  <p><strong>Email:</strong> {viewUserSheet.email}</p>
                  <p><strong>Status:</strong> {getStatusBadge(viewUserSheet)}</p>
                  <p><strong>Created:</strong> {new Date(viewUserSheet.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              {activeTab === 'students' && (
                <>
                  <div>
                    <h4 className="font-semibold">Registration Information</h4>
                    <div className="space-y-2 mt-2">
                      <p><strong>Source:</strong> {viewUserSheet.source || 'Website'}</p>
                      {viewUserSheet.source === 'College' && viewUserSheet.college_name && (
                        <p><strong>College:</strong> {viewUserSheet.college_name}</p>
                      )}
                      <p><strong>Last Active:</strong> {
                        viewUserSheet.last_active 
                          ? new Date(viewUserSheet.last_active).toLocaleString()
                          : 'Never'
                      }</p>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold">Performance Metrics</h4>
                    <div className="space-y-2 mt-2">
                      <p><strong>Trust Score:</strong> {viewUserSheet.trust_score || 0}</p>
                      <p><strong>Total XP:</strong> {viewUserSheet.total_xp || 0}</p>
                      <p><strong>Proofs Submitted:</strong> {viewUserSheet.proofs_submitted || 0}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirmation Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription>
              Are you sure you want to {actionType} this {activeTab.slice(0, -1)}? 
              {actionType === 'delete' && ' This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedUser(null)}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'block' || actionType === 'suspend' || actionType === 'delete' ? 'destructive' : 'default'}
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

export default EnhancedUserManagement;