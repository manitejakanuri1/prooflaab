import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
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
import { Search, MoreVertical, Clock, Star, User, Calendar, CheckCircle, Flag, Trash2, FileText, Trophy } from "lucide-react";

const TaskOversight = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("due_date");
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [actionType, setActionType] = useState<'approve' | 'flag' | 'remove'>('approve');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['admin-tasks', searchTerm, statusFilter, sortBy],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select(`
          *,
          student_profiles!tasks_student_id_fkey(full_name)
        `);

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

      const sortField = sortBy === 'due_date' ? 'due_date' : sortBy === 'xp_reward' ? 'xp_reward' : 'status';
      const { data, error } = await query.order(sortField, { ascending: sortBy === 'due_date' });
      if (error) throw error;
      return data;
    }
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, updates }: { taskId: string; updates: any }) => {
      const { error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', taskId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      toast({
        title: "Success",
        description: `Task ${actionType}d successfully.`,
      });
      setSelectedTask(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to ${actionType} task: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleTaskAction = (task: any, action: 'approve' | 'flag' | 'remove') => {
    setSelectedTask(task);
    setActionType(action);
  };

  const confirmAction = () => {
    if (!selectedTask) return;

    let updates: any = {};
    
    if (actionType === 'approve') {
      updates.approved_by_admin = true;
    } else if (actionType === 'flag') {
      updates.status = 'Flagged';
    } else if (actionType === 'remove') {
      updates.status = 'Removed';
    }

    updateTaskMutation.mutate({
      taskId: selectedTask.id,
      updates
    });
  };

  const getStatusBadge = (task: any) => {
    const status = task.status || 'Pending';
    const isOverdue = new Date(task.due_date) < new Date() && status !== 'Completed';
    
    if (isOverdue) {
      return <Badge className="bg-red-50 text-red-700 border-red-200">🔴 Overdue</Badge>;
    }
    
    const statusConfig = {
      'Completed': { color: 'bg-green-50 text-green-700 border-green-200', emoji: '🟢' },
      'In Progress': { color: 'bg-blue-50 text-blue-700 border-blue-200', emoji: '🔵' },
      'Assigned': { color: 'bg-blue-50 text-blue-700 border-blue-200', emoji: '🔵' },
      'Pending': { color: 'bg-gray-50 text-gray-700 border-gray-200', emoji: '⚪' },
      'Flagged': { color: 'bg-red-50 text-red-700 border-red-200', emoji: '🚩' },
      'Removed': { color: 'bg-red-50 text-red-700 border-red-200', emoji: '❌' }
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.Pending;
    return <Badge className={`${config.color} border`}>{config.emoji} {status}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    return status === 'Completed' ? '📝' : '📌';
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
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Task Dashboard</h2>
          <p className="text-muted-foreground mt-1">Track and manage all assigned tasks in one place</p>
        </div>
        <div className="flex gap-2">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due_date">Due Date</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="xp_reward">XP Reward</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search tasks…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 rounded-lg shadow-sm"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={statusFilter === 'active' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('active')}
            className="rounded-full"
          >
            🔵 Active
          </Button>
          <Button
            variant={statusFilter === 'completed' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('completed')}
            className="rounded-full"
          >
            🟢 Completed
          </Button>
          <Button
            variant={statusFilter === 'overdue' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('overdue')}
            className="rounded-full"
          >
            🟠 Overdue
          </Button>
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('all')}
            className="rounded-full"
          >
            ⚪ All
          </Button>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {!tasks || tasks.length === 0 ? (
        <Card className="p-16">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Trophy className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">🎉 No tasks assigned yet!</h3>
          <p className="text-muted-foreground">New challenges coming soon.</p>
        </Card>
        ) : (
          tasks.map((task) => (
            <Card key={task.id} className="p-4 hover:shadow-md transition-shadow border border-border">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{getStatusIcon(task.status)}</span>
                    <h3 className="font-semibold text-foreground">{task.title}</h3>
                    <Badge variant="outline" className="text-xs">
                      {task.category || 'General'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      <span>Created by: {(task as any).student_profiles?.full_name || 'Admin'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>Due: {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      <span>⭐ +{task.xp_reward || task.xp || 0} XP</span>
                    </div>
                  </div>
                  <div className="mt-2">
                    {getStatusBadge(task)}
                  </div>
                </div>
                <div className="ml-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!task.approved_by_admin && (
                        <DropdownMenuItem onClick={() => handleTaskAction(task, 'approve')}>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Approve
                        </DropdownMenuItem>
                      )}
                      {task.status !== 'Flagged' && (
                        <DropdownMenuItem onClick={() => handleTaskAction(task, 'flag')}>
                          <Flag className="h-4 w-4 mr-2" />
                          Flag
                        </DropdownMenuItem>
                      )}
                      {task.status !== 'Removed' && (
                        <DropdownMenuItem 
                          onClick={() => handleTaskAction(task, 'remove')}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={!!selectedTask} onOpenChange={() => setSelectedTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription>
              Are you sure you want to {actionType} this task? This action will affect its visibility and status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTask(null)}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'remove' ? 'destructive' : 'default'}
              onClick={confirmAction}
              disabled={updateTaskMutation.isPending}
            >
              {updateTaskMutation.isPending ? 'Processing...' : `${actionType} Task`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TaskOversight;