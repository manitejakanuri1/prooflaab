import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, Clock, Users, Edit, Trash2 } from "lucide-react";
import { useStartupTasks } from "@/hooks/useStartupTasks";
import { format } from "date-fns";

interface StartupViewTasksPageProps {
  onNavigateToPostTask: () => void;
}

export function StartupViewTasksPage({ onNavigateToPostTask }: StartupViewTasksPageProps) {
  const { tasks, loading, error } = useStartupTasks();

  const getDescriptionSnippet = (description: string) => {
    if (!description) return "No description provided";
    return description.length > 100 ? description.substring(0, 100) + "..." : description;
  };

  const getStatusVariant = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':
      case 'open':
        return 'default';
      case 'completed':
      case 'closed':
        return 'secondary';
      case 'in progress':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive">Error loading tasks: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Posted Tasks</h2>
          <p className="text-muted-foreground">Manage your internship tasks</p>
        </div>
        <Button onClick={onNavigateToPostTask}>Post New Task</Button>
      </div>

      <div className="flex gap-4 mb-6">
        <Input placeholder="Search tasks..." className="max-w-sm" />
        <Button variant="outline">Filter</Button>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No tasks posted yet. Create your first task to get started!</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {tasks.map((task) => (
            <Card key={task.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{task.title}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {getDescriptionSnippet(task.description || "")}
                    </p>
                  </div>
                  <Badge variant={getStatusVariant(task.status)}>
                    {task.status || 'Pending'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>Posted {format(new Date(task.created_at), 'MMM dd, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Due {format(new Date(task.deadline), 'MMM dd, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>{task.applicant_count || 0} applications</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" title="Edit task">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" title="Delete task">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}