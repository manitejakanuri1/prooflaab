import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { User } from "lucide-react";

interface ViewAssignedStudentsModalProps {
  task: any;
  open: boolean;
  onClose: () => void;
}

export function ViewAssignedStudentsModal({ task, open, onClose }: ViewAssignedStudentsModalProps) {
  if (!task) return null;

  const getProgressStatus = (task: any) => {
    if (!task.student_profiles) return "Not Started";
    
    const proofs = task.proof_uploads || [];
    if (proofs.length === 0) return "Not Started";
    
    const latestProof = proofs[0];
    if (latestProof.status === 'Verified') return "Completed";
    if (latestProof.status === 'Rejected') return "Rejected";
    if (latestProof.submitted_at) return "Submitted";
    
    return task.status === 'In Progress' ? "In Progress" : "Not Started";
  };

  const getProgressBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    if (status === "Completed") return "default";
    if (status === "In Progress" || status === "Submitted") return "secondary";
    if (status === "Rejected") return "destructive";
    return "outline";
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assigned Students - {task.title}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          {task.student_profiles ? (
            <div className="border rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="h-12 w-12">
                  {task.student_profiles.profile_photo_url ? (
                    <img src={task.student_profiles.profile_photo_url} alt={task.student_profiles.full_name} />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center bg-primary/10">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                  )}
                </Avatar>
                <div>
                  <h4 className="font-semibold">{task.student_profiles.full_name}</h4>
                  <p className="text-sm text-muted-foreground">{task.student_profiles.email}</p>
                </div>
              </div>
              <Badge variant={getProgressBadgeVariant(getProgressStatus(task))}>
                {getProgressStatus(task)}
              </Badge>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No students assigned to this task yet</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
