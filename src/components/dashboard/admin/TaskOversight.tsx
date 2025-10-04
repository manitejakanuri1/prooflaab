import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, MoreVertical, Clock, Star, ChevronDown, ChevronRight, Edit, Users, UserPlus, Flag, Trash2, Building2, Briefcase, Shield } from "lucide-react";
import { ViewAssignedStudentsModal } from "./ViewAssignedStudentsModal";
import { EditTaskModal } from "./EditTaskModal";
import { ReassignTaskModal } from "./ReassignTaskModal";

const TaskOversight = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dueDateFilter, setDueDateFilter] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [viewStudentsTask, setViewStudentsTask] = useState<any>(null);
  const [editTask, setEditTask] = useState<any>(null);
  const [reassignTask, setReassignTask] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading, error } = useQuery({
    queryKey: ['admin-tasks', searchTerm, statusFilter, creatorFilter, categoryFilter, dueDateFilter],
    queryFn: async () => {
      console.log('Fetching tasks...');
      let query = supabase
        .from('tasks')
        .select('*');

      if (searchTerm) {
        query = query.ilike('title', `%${searchTerm}%`);
      }

      if (statusFilter !== 'all') {
        if (statusFilter === 'active') {
          query = query.in('status', ['Pending', 'In Progress', 'Assigned']);
        } else if (statusFilter === 'completed') {
          query = query.eq('status', 'Completed');
        } else if (statusFilter === 'overdue') {
          query = query.lt('due_date', new Date().toISOString()).neq('status', 'Completed');
        }
      }

      if (creatorFilter !== 'all') {
        if (creatorFilter === 'college') {
          query = query.not('created_by_college_id', 'is', null);
        } else if (creatorFilter === 'startup') {
          query = query.not('created_by_startup_id', 'is', null);
        } else if (creatorFilter === 'admin') {
          query = query.not('created_by_admin_id', 'is', null);
        }
      }

      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      if (dueDateFilter !== 'all') {
        const now = new Date();
        if (dueDateFilter === 'today') {
          const endOfDay = new Date(now.setHours(23, 59, 59, 999));
          query = query.lte('due_date', endOfDay.toISOString());
        } else if (dueDateFilter === 'week') {
          const weekFromNow = new Date(now.setDate(now.getDate() + 7));
          query = query.lte('due_date', weekFromNow.toISOString());
        } else if (dueDateFilter === 'month') {
          const monthFromNow = new Date(now.setMonth(now.getMonth() + 1));
          query = query.lte('due_date', monthFromNow.toISOString());
        }
      }

      const { data: tasksData, error: tasksError } = await query.order('created_at', { ascending: false });
      if (tasksError) {
        console.error('Task fetch error:', tasksError);
        throw tasksError;
      }
      
      console.log('Tasks fetched:', tasksData);
      
      // Fetch related data separately and merge
      const enrichedTasks = await Promise.all(
        (tasksData || []).map(async (task) => {
          const enrichedTask: any = { ...task };
          
          // Fetch college data
          if (task.created_by_college_id) {
            const { data: college } = await supabase
              .from('colleges')
              .select('id, name')
              .eq('id', task.created_by_college_id)
              .single();
            enrichedTask.colleges = college;
          }
          
          // Fetch startup data
          if (task.created_by_startup_id) {
            const { data: startup } = await supabase
              .from('startups')
              .select('id, name')
              .eq('user_id', task.created_by_startup_id)
              .single();
            enrichedTask.startups = startup;
          }
          
          // Fetch student data
          if (task.student_id) {
            const { data: student } = await supabase
              .from('student_profiles')
              .select('id, full_name, email, profile_photo_url')
              .eq('id', task.student_id)
              .single();
            enrichedTask.student_profiles = student;
          }
          
          // Fetch proof uploads
          const { data: proofs } = await supabase
            .from('proof_uploads')
            .select('id, status, submitted_at')
            .eq('task_id', task.id)
            .order('submitted_at', { ascending: false });
          enrichedTask.proof_uploads = proofs || [];
          
          return enrichedTask;
        })
      );
      
      console.log('Enriched tasks:', enrichedTasks);
      return enrichedTasks;
    }
  });

  const flagTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'Flagged' })
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      toast({ title: "Success", description: "Task flagged for review." });
    }
  });

  const removeTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      toast({ title: "Success", description: "Task removed successfully." });
    }
  });

  const toggleRow = (taskId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedRows(newExpanded);
  };

  const getCreatorBadge = (task: any) => {
    if (task.created_by_college_id && task.colleges) {
      return (
        <Badge variant="outline" className="gap-1">
          <Building2 className="h-3 w-3" />
          {task.colleges.name}
        </Badge>
      );
    }
    if (task.created_by_startup_id && task.startups) {
      return (
        <Badge variant="outline" className="gap-1">
          <Briefcase className="h-3 w-3" />
          {task.startups.name}
        </Badge>
      );
    }
    if (task.created_by_admin_id) {
      return (
        <Badge variant="outline" className="gap-1">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    }
    return <Badge variant="outline">Unknown</Badge>;
  };

  const getStudentProgress = (task: any) => {
    if (!task.student_profiles) return "Not Started";
    
    const proofs = task.proof_uploads || [];
    if (proofs.length === 0) return "Not Started";
    
    const latestProof = proofs[0];
    if (latestProof.status === 'Verified') return "Completed";
    if (latestProof.status === 'Rejected') return "Rejected";
    if (latestProof.submitted_at) return "Submitted";
    
    return task.status === 'In Progress' ? "In Progress" : "Not Started";
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
      'Completed': { variant: 'default', label: 'Completed' },
      'In Progress': { variant: 'secondary', label: 'In Progress' },
      'Assigned': { variant: 'secondary', label: 'Assigned' },
      'Pending': { variant: 'outline', label: 'Pending' },
      'Flagged': { variant: 'destructive', label: 'Flagged' }
    };
    
    const config = statusConfig[status] || statusConfig.Pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
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

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-3xl font-bold">Task Oversight</h2>
        <div className="border rounded-lg bg-destructive/10 p-6 text-center">
          <p className="text-destructive font-semibold">Error loading tasks</p>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold">Task Oversight</h2>
        <p className="text-muted-foreground mt-1">Monitor and manage all tasks across the platform</p>
      </div>

      {/* Search & Filters */}
      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search tasks by title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>

          <Select value={creatorFilter} onValueChange={setCreatorFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Creator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Creators</SelectItem>
              <SelectItem value="college">Colleges</SelectItem>
              <SelectItem value="startup">Startups</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="Development">Development</SelectItem>
              <SelectItem value="Design">Design</SelectItem>
              <SelectItem value="Marketing">Marketing</SelectItem>
              <SelectItem value="General">General</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dueDateFilter} onValueChange={setDueDateFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Due Date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Dates</SelectItem>
              <SelectItem value="today">Due Today</SelectItem>
              <SelectItem value="week">Due This Week</SelectItem>
              <SelectItem value="month">Due This Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tasks Table */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : !tasks || tasks.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <p className="text-muted-foreground">No tasks found</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>XP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <>
                  <TableRow key={task.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell onClick={() => toggleRow(task.id)}>
                      {expandedRows.has(task.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{task.title}</TableCell>
                    <TableCell>{getCreatorBadge(task)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{task.category || 'General'}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-primary text-primary" />
                        <span>{task.xp_reward || task.xp || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(task.status)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditTask(task)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit Task
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setViewStudentsTask(task)}>
                            <Users className="h-4 w-4 mr-2" />
                            View Assigned Students
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setReassignTask(task)}>
                            <UserPlus className="h-4 w-4 mr-2" />
                            Reassign Task
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => flagTaskMutation.mutate(task.id)}>
                            <Flag className="h-4 w-4 mr-2" />
                            Flag for Review
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => removeTaskMutation.mutate(task.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove Task
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  
                  {/* Expanded Row - Assigned Students */}
                  {expandedRows.has(task.id) && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30">
                        <div className="py-3 px-4">
                          <h4 className="font-semibold mb-3 text-sm">Assigned Students</h4>
                          {task.student_profiles ? (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between p-3 bg-background rounded border">
                                <div className="flex items-center gap-3">
                                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    <span className="text-sm font-medium">
                                      {task.student_profiles.full_name?.charAt(0) || '?'}
                                    </span>
                                  </div>
                                  <div>
                                    <p className="font-medium text-sm">{task.student_profiles.full_name}</p>
                                    <p className="text-xs text-muted-foreground">{task.student_profiles.email}</p>
                                  </div>
                                </div>
                                <Badge variant="secondary">{getStudentProgress(task)}</Badge>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No students assigned yet</p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modals */}
      <ViewAssignedStudentsModal
        task={viewStudentsTask}
        open={!!viewStudentsTask}
        onClose={() => setViewStudentsTask(null)}
      />
      <EditTaskModal
        task={editTask}
        open={!!editTask}
        onClose={() => setEditTask(null)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['admin-tasks'] })}
      />
      <ReassignTaskModal
        task={reassignTask}
        open={!!reassignTask}
        onClose={() => setReassignTask(null)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['admin-tasks'] })}
      />
    </div>
  );
};

export default TaskOversight;