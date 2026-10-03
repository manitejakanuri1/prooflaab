import { useState } from "react";
import React from "react";
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
import { Search, MoreVertical, Clock, Star, ChevronDown, ChevronRight, Edit, Users, UserPlus, Flag, Trash2, Building2, Briefcase, Shield, Eye, EyeOff, User } from "lucide-react";
import { ViewAssignedStudentsModal } from "./ViewAssignedStudentsModal";
import { EditTaskModal } from "./EditTaskModal";
import { ReassignTaskModal } from "./ReassignTaskModal";
import { TaskDetailsModal } from "./TaskDetailsModal";
import { ADMIN_LIST_CAP } from "@/lib/listCaps";

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
  const [detailsTask, setDetailsTask] = useState<any>(null);
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

      const { data: tasksData, error: tasksError } = await query.order('created_at', { ascending: false }).limit(ADMIN_LIST_CAP);
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
            const { data: college, error: collegeError } = await supabase
              .from('colleges')
              .select('id, name')
              .eq('id', task.created_by_college_id)
              .maybeSingle();
            
            if (collegeError) {
              console.error('Error fetching college:', collegeError, 'for task:', task.id);
            }
            enrichedTask.colleges = college;
          }
          
          // Fetch startup data
          if (task.created_by_startup_id) {
            const { data: startup, error: startupError } = await supabase
              .from('startups')
              .select('id, name')
              .eq('user_id', task.created_by_startup_id)
              .maybeSingle();
            
            if (startupError) {
              console.error('Error fetching startup:', startupError, 'for task:', task.id);
            }
            enrichedTask.startups = startup;
          }
          
          // Fetch student creator data (for student-created tasks)
          if (task.created_by_type === 'student' && task.student_id) {
            const { data: studentCreator } = await supabase
              .from('student_profiles')
              .select('id, full_name')
              .eq('id', task.student_id)
              .maybeSingle();
            enrichedTask.student_creator = studentCreator;
            enrichedTask.created_by_student_id = task.student_id;
          }
          
          // Fetch assigned students from task_assignments table
          const { data: assignments } = await supabase
            .from('task_assignments')
            .select(`
              id,
              student_id,
              status,
              assigned_at,
              student_profiles:student_id (
                id,
                full_name,
                profile_photo_url,
                student_contact (email)
              )
            `)
            .eq('task_id', task.id);
          enrichedTask.task_assignments = assignments || [];
          
          // Also keep direct student assignment for backwards compatibility
          if (task.student_id) {
            const { data: student, error: studentError } = await supabase
              .from('student_profiles')
              // email moved to student_contact
              .select('id, full_name, profile_photo_url, student_contact (email)')
              .eq('id', task.student_id)
              .maybeSingle();

            if (studentError) {
              console.error('Error fetching student:', studentError, 'for task:', task.id);
            }
            enrichedTask.student_profiles = student
              ? { ...student, email: (student as any).student_contact?.email ?? '' }
              : student;
          }
          
          // The student's graded attempts (task_submissions)
          const { data: proofs } = await supabase
            .from('task_submissions')
            .select('id, status, submitted_at:created_at')
            .eq('task_id', task.id)
            .order('created_at', { ascending: false });
          enrichedTask.submissions = proofs || [];
          
          return enrichedTask;
        })
      );
      
      console.log('Enriched tasks:', enrichedTasks);
      return enrichedTasks;
    }
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({ taskId, currentVisibility }: { taskId: string, currentVisibility: string }) => {
      const newVisibility = currentVisibility === 'public' ? 'private' : 'public';
      const { error } = await supabase
        .from('tasks')
        .update({ visibility: newVisibility })
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      toast({ title: "Success", description: "Task visibility toggled successfully." });
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
    // Admin created
    if (task.created_by_admin_id) {
      return (
        <Badge variant="outline" className="gap-1 border-orange-500 text-orange-700 dark:text-orange-300">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    }
    
    // College created
    if (task.created_by_college_id) {
      if (task.colleges?.name) {
        return (
          <Badge variant="outline" className="gap-1 border-blue-500 text-blue-700 dark:text-blue-300">
            <Building2 className="h-3 w-3" />
            {task.colleges.name}
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="gap-1 border-blue-500 text-blue-700 dark:text-blue-300">
          <Building2 className="h-3 w-3" />
          College
        </Badge>
      );
    }
    
    // Startup created
    if (task.created_by_startup_id) {
      if (task.startups?.name) {
        return (
          <Badge variant="outline" className="gap-1 border-purple-500 text-purple-700 dark:text-purple-300">
            <Briefcase className="h-3 w-3" />
            {task.startups.name}
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="gap-1 border-purple-500 text-purple-700 dark:text-purple-300">
          <Briefcase className="h-3 w-3" />
          Startup
        </Badge>
      );
    }
    
    // Student created
    if (task.created_by_type === 'student' || task.created_by_student_id) {
      if (task.student_creator?.full_name) {
        return (
          <Badge variant="outline" className="gap-1 border-green-500 text-green-700 dark:text-green-300">
            <User className="h-3 w-3" />
            {task.student_creator.full_name}
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="gap-1 border-green-500 text-green-700 dark:text-green-300">
          <User className="h-3 w-3" />
          Student
        </Badge>
      );
    }
    
    // Fallback based on source field
    if (task.source === 'admin' || task.created_by_type === 'admin') {
      return (
        <Badge variant="outline" className="gap-1 border-orange-500 text-orange-700 dark:text-orange-300">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    }
    
    return <Badge variant="outline">Unknown</Badge>;
  };

  const getStudentProgress = (task: any) => {
    if (!task.student_profiles) return "Not Started";
    
    const proofs = task.submissions || [];
    if (proofs.length === 0) return "Not Started";
    
    const latest = proofs[0];
    if (latest.status === 'passed') return "Completed";
    if (latest.status === 'failed') return "Not passed yet";
    if (latest.status === 'needs_review') return "Being checked";
    if (latest.submitted_at) return "Submitted";
    
    return task.status === 'In Progress' ? "In Progress" : "Not Started";
  };

  const getStatusBadge = (status: string, dueDate: string) => {
    const isOverdue = new Date(dueDate) < new Date() && status !== 'Completed';
    
    if (isOverdue) {
      return <Badge className="bg-red-500 text-white hover:bg-red-500">Overdue</Badge>;
    }
    
    const statusConfig: Record<string, { className: string, label: string }> = {
      'Completed': { className: 'bg-blue-500 text-white hover:bg-blue-500', label: 'Completed' },
      'In Progress': { className: 'bg-green-500 text-white hover:bg-green-500', label: 'Active' },
      'Assigned': { className: 'bg-green-500 text-white hover:bg-green-500', label: 'Active' },
      'Pending': { className: 'bg-orange-500 text-white hover:bg-orange-500', label: 'Pending' }
    };
    
    const config = statusConfig[status] || statusConfig.Pending;
    return <Badge className={config.className}>{config.label}</Badge>;
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0 space-y-4 md:space-y-6 pb-4 px-4 md:px-0 bg-background border-b">
        {/* Header */}
        <div>
          <h2 className="text-2xl md:text-3xl font-bold">Task Oversight</h2>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">Monitor and manage all tasks across the platform</p>
        </div>

        {/* Search & Filters */}
        <div className="space-y-3 md:space-y-4">
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search tasks by title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-xs md:text-sm">
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
              <SelectTrigger className="text-xs md:text-sm">
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
              <SelectTrigger className="text-xs md:text-sm">
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
              <SelectTrigger className="text-xs md:text-sm">
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
      </div>

      {/* Scrollable Table Container */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : !tasks || tasks.length === 0 ? (
          <div className="text-center py-12 mx-4 border rounded-lg bg-muted/20">
            <p className="text-muted-foreground">No tasks found</p>
          </div>
        ) : (
          <div className="h-full overflow-auto">
            {/* Desktop Table View */}
            <div className="hidden md:block border rounded-lg m-4">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="w-12 bg-background"></TableHead>
                    <TableHead className="bg-background">Task</TableHead>
                    <TableHead className="bg-background">Creator</TableHead>
                    <TableHead className="bg-background">Category</TableHead>
                    <TableHead className="bg-background">Due Date</TableHead>
                    <TableHead className="bg-background">XP</TableHead>
                    <TableHead className="bg-background">Status</TableHead>
                    <TableHead className="w-12 bg-background"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
              {tasks.map((task) => (
                <React.Fragment key={task.id}>
                  <TableRow className="cursor-pointer hover:bg-muted/50">
                    <TableCell onClick={() => toggleRow(task.id)}>
                      {expandedRows.has(task.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </TableCell>
                    <TableCell 
                      className="font-medium cursor-pointer hover:text-primary hover:underline"
                      onClick={() => setDetailsTask(task)}
                    >
                      {task.title}
                    </TableCell>
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
                    <TableCell>{getStatusBadge(task.status, task.due_date)}</TableCell>
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
                          <DropdownMenuItem onClick={() => toggleVisibilityMutation.mutate({ taskId: task.id, currentVisibility: task.visibility })}>
                            {task.visibility === 'public' ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                            Toggle Visibility ({task.visibility === 'public' ? 'Make Private' : 'Make Active'})
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
                          {task.task_assignments && task.task_assignments.length > 0 ? (
                            <div className="space-y-2">
                              {task.task_assignments.map((assignment: any) => (
                                <div key={assignment.id} className="flex items-center justify-between p-3 bg-background rounded border">
                                  <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                      <span className="text-sm font-medium">
                                        {assignment.student_profiles?.full_name?.charAt(0) || '?'}
                                      </span>
                                    </div>
                                    <div>
                                      <p className="font-medium text-sm">{assignment.student_profiles?.full_name || 'Unknown'}</p>
                                      <p className="text-xs text-muted-foreground">{assignment.student_profiles?.student_contact?.email || 'N/A'}</p>
                                    </div>
                                  </div>
                                  <Badge variant="secondary">{assignment.status || 'Assigned'}</Badge>
                                </div>
                              ))}
                            </div>
                          ) : task.student_profiles ? (
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
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3 p-4">
              {tasks.map((task) => (
                <div key={task.id} className="border rounded-lg bg-card">
                  <div className="p-4 space-y-3">
                    {/* Task Title & Status */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 
                        className="font-medium text-sm flex-1 line-clamp-2 cursor-pointer hover:text-primary hover:underline"
                        onClick={() => setDetailsTask(task)}
                      >
                        {task.title}
                      </h3>
                      {getStatusBadge(task.status, task.due_date)}
                    </div>

                    {/* Creator & Category */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {getCreatorBadge(task)}
                      <Badge variant="outline" className="text-xs">{task.category || 'General'}</Badge>
                    </div>

                    {/* Due Date & XP */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-primary text-primary" />
                        <span className="font-medium text-foreground">{task.xp_reward || task.xp || 0} XP</span>
                      </div>
                    </div>

                    {/* Assigned Student (if any) */}
                    {task.student_profiles && (
                      <div className="pt-2 border-t">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-medium">
                              {task.student_profiles.full_name?.charAt(0) || '?'}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-xs truncate">{task.student_profiles.full_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{task.student_profiles.email}</p>
                          </div>
                          <Badge variant="secondary" className="text-xs">{getStudentProgress(task)}</Badge>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={() => setEditTask(task)}
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={() => setViewStudentsTask(task)}
                      >
                        <Users className="h-3 w-3 mr-1" />
                        Students
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setReassignTask(task)}>
                            <UserPlus className="h-4 w-4 mr-2" />
                            Reassign
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => flagTaskMutation.mutate(task.id)}>
                            <Flag className="h-4 w-4 mr-2" />
                            Flag
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => removeTaskMutation.mutate(task.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <TaskDetailsModal
        task={detailsTask}
        open={!!detailsTask}
        onClose={() => setDetailsTask(null)}
      />
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