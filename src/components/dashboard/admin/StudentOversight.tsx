import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { confirmRemoval, removeStudents } from "@/lib/removeStudents";
import { Trash2 } from "lucide-react";
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
import { Search, Users, Plus, Eye, Edit, Pause, MoreHorizontal } from "lucide-react";
import { ADMIN_LIST_CAP } from "@/lib/listCaps";

const StudentOversight = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'view' | 'edit' | 'add' | null>(null);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    status: 'active',
    branch: '',
    batch: '',
    college_id: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: students, isLoading } = useQuery({
    queryKey: ['student-oversight', searchTerm],
    queryFn: async () => {
      // email moved to student_contact. It has to be pulled in explicitly now,
      // and the search can only match on the name — PostgREST cannot filter a
      // parent row by a column on an embedded table.
      let query = supabase
        .from('student_profiles')
        .select(`
          *,
          student_contact (email),
          tasks:tasks!tasks_student_id_fkey(count)
        `);

      if (searchTerm) {
        query = query.ilike('full_name', `%${searchTerm}%`);
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(ADMIN_LIST_CAP);
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        ...s,
        email: s.student_contact?.email ?? '',
      }));
    }
  });

  const { data: colleges } = useQuery({
    queryKey: ['colleges-for-student-oversight'],
    queryFn: async () => {
      const { data, error } = await supabase.from('colleges').select('id, name').order('name');
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // A student needs a real sign-in account, which the browser can't create
      // on its own — that needs the service-role key, which lives server-side.
      // This used to insert a fake 'temp-user-id' string directly, which isn't
      // even a valid uuid; it failed every time rather than creating anyone.
      // create-student-users already does this correctly for CSV import, so
      // this reuses it for one student instead of a batch.
      if (!data.college_id) throw new Error('Pick a college first.');
      const { data: result, error } = await supabase.functions.invoke('create-student-users', {
        body: {
          college_id: data.college_id,
          students: [{
            name: data.full_name,
            email: data.email,
            branch: data.branch,
            batch: data.batch,
            year_of_study: data.batch,
          }],
        },
      });
      if (error) throw error;
      const row = result?.results?.[0];
      if (row?.status === 'error') throw new Error(row.message ?? 'Could not create the student.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-oversight'] });
      toast({
        title: "Success",
        description: "Student added and invited.",
      });
      closeModal();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to add student: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      // The form still has one email field, but it belongs to a different
      // table now, so the update splits in two.
      const { email, ...profileFields } = data;

      const { error } = await supabase
        .from('student_profiles')
        .update(profileFields)
        .eq('id', id);
      if (error) throw error;

      if (email !== undefined) {
        const { error: contactError } = await supabase
          .from('student_contact')
          .upsert({ student_id: id, email }, { onConflict: 'student_id' });
        if (contactError) throw contactError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-oversight'] });
      toast({
        title: "Success",
        description: "Student updated successfully.",
      });
      closeModal();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update student: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const suspendMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('student_profiles')
        .update({ status: 'suspended' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-oversight'] });
      toast({
        title: "Success",
        description: "Student suspended successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to suspend student: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const openModal = (mode: 'view' | 'edit' | 'add', student?: any) => {
    setViewMode(mode);
    setSelectedStudent(student);
    if (student) {
      setFormData({
        full_name: student.full_name || '',
        email: student.email || '',
        status: student.status || 'active',
        branch: student.branch || '',
        batch: student.batch || '',
        college_id: student.college_id || '',
      });
    } else {
      setFormData({ full_name: '', email: '', status: 'active', branch: '', batch: '', college_id: '' });
    }
  };

  const closeModal = () => {
    setViewMode(null);
    setSelectedStudent(null);
    setFormData({ full_name: '', email: '', status: 'active', branch: '', batch: '', college_id: '' });
  };

  const handleSave = () => {
    if (viewMode === 'add') {
      createMutation.mutate(formData);
    } else if (viewMode === 'edit' && selectedStudent) {
      updateMutation.mutate({ id: selectedStudent.id, data: formData });
    }
  };

  const handleSuspend = (student: any) => {
    if (confirm(`Suspend ${student.full_name}? This will prevent them from accessing the platform.`)) {
      suspendMutation.mutate(student.id);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      active: 'default',
      inactive: 'secondary',
      pending: 'outline',
      suspended: 'destructive'
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  const paginatedStudents = students?.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil((students?.length || 0) / itemsPerPage);

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
            <Users className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Student Oversight</h1>
            <p className="text-muted-foreground">Manage student accounts and activities</p>
          </div>
        </div>
        <Button onClick={() => openModal('add')} className="gap-2">
          <Plus className="h-4 w-4" />
          Add New Student
        </Button>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search student..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={itemsPerPage.toString()} onValueChange={(value) => setItemsPerPage(Number(value))}>
              <SelectTrigger className="w-24">
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
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="font-semibold">Email</TableHead>
                <TableHead className="font-semibold">College</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Tasks</TableHead>
                <TableHead className="font-semibold">Created</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedStudents?.map((student) => (
                <TableRow key={student.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">{student.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">{student.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{student.branch || 'N/A'}</Badge>
                  </TableCell>
                  <TableCell>{getStatusBadge(student.status)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {(student as any).tasks?.length || 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(student.created_at).toLocaleDateString('en-GB')}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openModal('view', student)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openModal('edit', student)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleSuspend(student)}
                          className="text-destructive"
                        >
                          <Pause className="h-4 w-4 mr-2" />
                          Suspend
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={async () => {
                            if (!confirmRemoval(student.full_name)) return;
                            try {
                              await removeStudents([student.id]);
                              toast({ title: `Removed ${student.full_name}` });
                              void queryClient.invalidateQueries();
                            } catch (e) {
                              toast({ title: "Not removed", description: (e as Error).message, variant: "destructive" });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove student
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, students?.length || 0)} of {students?.length || 0} students
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

      {/* Modal */}
      <Dialog open={!!viewMode} onOpenChange={closeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {viewMode === 'add' ? 'Add New Student' : 
               viewMode === 'edit' ? 'Edit Student' : 'Student Details'}
            </DialogTitle>
            <DialogDescription>
              {viewMode === 'view' ? 'View student information' : 
               viewMode === 'add' ? 'Add a new student to the platform' : 
               'Update student information'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Name</label>
              <Input
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                disabled={viewMode === 'view'}
                placeholder="Student full name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Email</label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={viewMode === 'view'}
                placeholder="Student email"
              />
            </div>
            {viewMode === 'add' && (
              <div>
                <label className="text-sm font-medium mb-2 block">College</label>
                <Select
                  value={formData.college_id}
                  onValueChange={(value) => setFormData({ ...formData, college_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a college" />
                  </SelectTrigger>
                  <SelectContent>
                    {(colleges ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium mb-2 block">Branch</label>
              <Input
                value={formData.branch}
                onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                disabled={viewMode === 'view'}
                placeholder="Student branch/department"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Batch</label>
              <Input
                value={formData.batch}
                onChange={(e) => setFormData({ ...formData, batch: e.target.value })}
                disabled={viewMode === 'view'}
                placeholder="Student batch/year"
              />
            </div>
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
                    <SelectItem value="inactive">Inactive</SelectItem>
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

export default StudentOversight;