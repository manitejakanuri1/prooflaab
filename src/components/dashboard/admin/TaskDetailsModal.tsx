import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Calendar, Star, Tag, Clock, Shield, Building2, Briefcase, User } from "lucide-react";

interface TaskDetailsModalProps {
  task: any;
  open: boolean;
  onClose: () => void;
}

export function TaskDetailsModal({ task, open, onClose }: TaskDetailsModalProps) {
  if (!task) return null;

  const getCreatorInfo = () => {
    if (task.created_by_admin_id) {
      return {
        icon: <Shield className="h-4 w-4" />,
        label: "Admin",
        className: "border-orange-500 text-orange-700 dark:text-orange-300"
      };
    }
    if (task.created_by_college_id && task.colleges?.name) {
      return {
        icon: <Building2 className="h-4 w-4" />,
        label: task.colleges.name,
        className: "border-blue-500 text-blue-700 dark:text-blue-300"
      };
    }
    if (task.created_by_startup_id && task.startups?.name) {
      return {
        icon: <Briefcase className="h-4 w-4" />,
        label: task.startups.name,
        className: "border-purple-500 text-purple-700 dark:text-purple-300"
      };
    }
    if (task.created_by_student_id && task.student_creator?.full_name) {
      return {
        icon: <User className="h-4 w-4" />,
        label: task.student_creator.full_name,
        className: "border-green-500 text-green-700 dark:text-green-300"
      };
    }
    return {
      icon: <User className="h-4 w-4" />,
      label: "Unknown",
      className: "border-gray-500 text-gray-700 dark:text-gray-300"
    };
  };

  const creator = getCreatorInfo();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{task.title}</DialogTitle>
          <DialogDescription>Complete task details and information</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 mt-4">
          {/* Creator Badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Created by:</span>
            <Badge variant="outline" className={`gap-1.5 ${creator.className}`}>
              {creator.icon}
              {creator.label}
            </Badge>
          </div>

          {/* Description */}
          {task.description && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Description
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {task.description}
              </p>
            </div>
          )}

          {/* Task Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Category</span>
              </div>
              <p className="text-sm text-muted-foreground">{task.category || 'General'}</p>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Star className="h-4 w-4 text-primary fill-primary" />
                <span className="text-sm font-medium">XP Reward</span>
              </div>
              <p className="text-sm font-semibold">{task.xp_reward || task.xp || 0} XP</p>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Due Date</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {new Date(task.due_date).toLocaleDateString('en-US', { 
                  month: 'long', 
                  day: 'numeric', 
                  year: 'numeric' 
                })}
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Duration</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {task.duration_days || 7} days
              </p>
            </div>
          </div>

          {/* Status */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Current Status</span>
              <Badge variant={
                task.status === 'Completed' ? 'default' : 
                task.status === 'In Progress' || task.status === 'Assigned' ? 'secondary' : 
                'outline'
              }>
                {task.status || 'Pending'}
              </Badge>
            </div>
          </div>

          {/* Additional Metadata */}
          <div className="text-xs text-muted-foreground pt-4 border-t">
            <div className="flex justify-between">
              <span>Created: {new Date(task.created_at).toLocaleDateString()}</span>
              {task.completed_at && (
                <span>Completed: {new Date(task.completed_at).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
