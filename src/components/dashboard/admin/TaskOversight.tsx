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
import { Search, Eye, CheckCircle, Flag, Trash2 } from "lucide-react";

const TaskOversight = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [actionType, setActionType] = useState<'approve' | 'flag' | 'remove'>('approve');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['admin-tasks', searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select(`
          *,
          startups(name),
          colleges(name)
        `);

      if (searchTerm) {
        query = query.ilike('title', `%${searchTerm}%`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
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
    return (
      <Badge variant={
        status === 'Completed' ? 'default' :
        status === 'In Progress' ? 'secondary' :
        status === 'Flagged' ? 'destructive' :
        status === 'Removed' ? 'destructive' : 'outline'
      }>
        {status}
      </Badge>
    );
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
        <div className="flex items-center gap-2">
          <Eye className="h-6 w-6" />
          <h2 className="text-2xl font-bold">Task Oversight</h2>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search tasks..."
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
                <TableHead>Created By</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>XP Reward</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks?.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.title}</TableCell>
                  <TableCell>
                    {(task as any).startups?.name || (task as any).colleges?.name || 'System'}
                  </TableCell>
                  <TableCell>{task.category}</TableCell>
                  <TableCell>
                    {new Date(task.due_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{getStatusBadge(task)}</TableCell>
                  <TableCell>{task.xp_reward || task.xp || 0}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      {!task.approved_by_admin && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleTaskAction(task, 'approve')}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                      {task.status !== 'Flagged' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTaskAction(task, 'flag')}
                        >
                          <Flag className="h-4 w-4" />
                        </Button>
                      )}
                      {task.status !== 'Removed' && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleTaskAction(task, 'remove')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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