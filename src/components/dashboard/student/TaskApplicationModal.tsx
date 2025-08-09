import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useApplyToTask } from "@/hooks/useTaskApplications";
import { format } from "date-fns";
import { Award, Calendar, DollarSign, FileText, Send, User, Link as LinkIcon } from "lucide-react";
import type { AvailableTask } from "@/hooks/useAvailableTasks";

interface TaskApplicationModalProps {
  task: AvailableTask;
  isOpen: boolean;
  onClose: () => void;
}

export function TaskApplicationModal({ task, isOpen, onClose }: TaskApplicationModalProps) {
  const [applicationNote, setApplicationNote] = useState("");
  const [portfolioLink, setPortfolioLink] = useState("");
  const applyToTask = useApplyToTask();

  const handleSubmit = async () => {
    if (!applicationNote.trim()) {
      return;
    }

    await applyToTask.mutateAsync({
      taskId: task.id,
      applicationNote: applicationNote.trim(),
      portfolioLink: portfolioLink.trim() || undefined,
    });

    onClose();
    setApplicationNote("");
    setPortfolioLink("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Apply for Task
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Task Details */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">{task.title}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{task.category}</Badge>
                {task.is_paid && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    <DollarSign className="h-3 w-3 mr-1" />
                    Paid
                  </Badge>
                )}
                <div className="flex items-center gap-1 ml-auto">
                  <Award className="h-4 w-4 text-orange-500" />
                  <span className="font-semibold">{task.xp_reward}</span>
                  <span className="text-sm text-muted-foreground">XP</span>
                </div>
              </div>
            </div>

            {task.description && (
              <div>
                <p className="text-sm text-muted-foreground">{task.description}</p>
              </div>
            )}

            {task.required_skills && task.required_skills.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Required Skills:</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {task.required_skills.map((skill, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Due: {format(new Date(task.due_date), "MMM dd, yyyy")}
              </div>
            </div>
          </div>

          <Separator />

          {/* Application Form */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="applicationNote" className="text-sm font-medium">
                Why are you interested in this task? *
              </Label>
              <Textarea
                id="applicationNote"
                value={applicationNote}
                onChange={(e) => setApplicationNote(e.target.value)}
                placeholder="Tell the startup why you're a good fit for this task. Mention relevant experience, skills, or projects..."
                className="mt-1 min-h-24"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                {applicationNote.length}/500 characters
              </p>
            </div>

            <div>
              <Label htmlFor="portfolioLink" className="text-sm font-medium">
                Portfolio/Work Sample Link (Optional)
              </Label>
              <Input
                id="portfolioLink"
                type="url"
                value={portfolioLink}
                onChange={(e) => setPortfolioLink(e.target.value)}
                placeholder="https://your-portfolio.com or GitHub repository"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Share a link to relevant work samples or your portfolio
              </p>
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={applyToTask.isPending}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={!applicationNote.trim() || applyToTask.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {applyToTask.isPending ? (
                "Submitting..."
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Submit Application
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}