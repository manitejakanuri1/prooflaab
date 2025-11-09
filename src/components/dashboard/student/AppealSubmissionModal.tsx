import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle } from "lucide-react";
import { useProofAppeals } from "@/hooks/useProofAppeals";

interface AppealSubmissionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proofId: string;
  studentId: string;
  taskTitle?: string;
}

const AppealSubmissionModal = ({ 
  open, 
  onOpenChange, 
  proofId,
  studentId,
  taskTitle 
}: AppealSubmissionModalProps) => {
  const [reason, setReason] = useState("");
  const { createAppeal } = useProofAppeals(studentId);

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    
    await createAppeal.mutateAsync({
      proofId,
      studentId,
      reason,
    });
    
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            Submit Appeal
          </DialogTitle>
          {taskTitle && (
            <p className="text-sm text-muted-foreground">Task: {taskTitle}</p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Explain why you believe your submission was incorrectly rejected and should be reviewed again.
            Please provide specific details about your work and any evidence that supports your claim.
          </p>

          <Textarea
            placeholder="Enter your appeal reason (minimum 50 characters)..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[150px]"
          />

          <p className="text-xs text-muted-foreground">
            {reason.length} / 50 characters minimum
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={reason.length < 50 || createAppeal.isPending}
          >
            {createAppeal.isPending ? "Submitting..." : "Submit Appeal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AppealSubmissionModal;
