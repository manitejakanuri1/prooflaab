import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Award, Play, Upload } from "lucide-react";
import { format } from "date-fns";

interface TaskDetailsDialogProps {
  task: {
    id: string;
    title: string;
    description: string | null;
    deadline: string;
    status: string;
    source: string;
    xp_reward: number | null;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onStartTask?: (taskId: string) => void;
  onUploadProof?: (taskId: string) => void;
}

const TaskDetailsDialog = ({
  task,
  isOpen,
  onClose,
  onStartTask,
  onUploadProof,
}: TaskDetailsDialogProps) => {
  if (!task) return null;

  const getSourceBadgeColor = (source: string) => {
    const normalizedSource = source?.toLowerCase() || '';
    if (normalizedSource === 'college') return 'bg-primary/10 text-primary border-primary/40';
    if (normalizedSource === 'admin') return 'bg-muted text-muted-foreground border-border';
    if (normalizedSource === 'startup') return 'bg-verified/10 text-verified border-verified/40';
    return 'bg-muted text-muted-foreground border-border';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Applied':
        return 'bg-compete/10 text-compete border-compete/40';
      case 'In Progress':
        return 'bg-primary/10 text-primary border-primary/40';
      case 'Completed':
        return 'bg-verified/10 text-verified border-verified/40';
      case 'Under Review':
        return 'bg-compete/10 text-compete border-compete/40';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const formatDueDate = (deadline: string) => {
    if (!deadline) return "Not Set";
    try {
      return format(new Date(deadline), "MMMM dd, yyyy");
    } catch {
      return deadline;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold pr-8">{task.title}</DialogTitle>
          <div className="flex items-center gap-2 pt-2">
            <Badge variant="outline" className={getSourceBadgeColor(task.source)}>
              {task.source}
            </Badge>
            <Badge variant="outline" className={getStatusColor(task.status)}>
              {task.status === 'Applied' ? 'Not started' : task.status}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Task Details */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Description</h3>
              <DialogDescription className="text-base text-foreground whitespace-pre-wrap">
                {task.description || "No description provided."}
              </DialogDescription>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="text-sm font-medium">{formatDueDate(task.deadline)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-compete" />
                <div>
                  <p className="text-xs text-muted-foreground">XP Reward</p>
                  <p className="text-sm font-medium text-compete">{task.xp_reward || 0} XP</p>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            {task.status === 'Applied' && onStartTask && (
              <Button
                onClick={() => {
                  onStartTask(task.id);
                  onClose();
                }}
                className="flex-1 bg-primary hover:bg-primary/90"
              >
                <Play className="h-4 w-4 mr-2" />
                Start Task
              </Button>
            )}
            {task.status === 'In Progress' && onUploadProof && (
              <Button
                onClick={() => {
                  onUploadProof(task.id);
                  onClose();
                }}
                className="flex-1"
              >
                <Upload className="h-4 w-4 mr-2" />
                Submit Proof
              </Button>
            )}
            <Button onClick={onClose} variant="outline" className="flex-1">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TaskDetailsDialog;
