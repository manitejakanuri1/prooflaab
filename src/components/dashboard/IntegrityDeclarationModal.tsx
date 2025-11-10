import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";

interface IntegrityDeclarationModalProps {
  open: boolean;
  onConfirm: (declaration: { acknowledged: boolean; text?: string }) => void;
  onCancel: () => void;
}

export const IntegrityDeclarationModal = ({
  open,
  onConfirm,
  onCancel,
}: IntegrityDeclarationModalProps) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [declarationText, setDeclarationText] = useState("");

  const handleConfirm = () => {
    onConfirm({
      acknowledged,
      text: declarationText.trim() || undefined,
    });
    // Reset for next time
    setAcknowledged(false);
    setDeclarationText("");
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-6 w-6 text-primary" />
            <DialogTitle>Learning Integrity Declaration</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            ProofLabAI celebrates authentic learning. Please confirm this work
            reflects your own understanding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="integrity-check"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
            />
            <Label
              htmlFor="integrity-check"
              className="text-sm font-medium leading-relaxed cursor-pointer"
            >
              I confirm this work reflects my understanding and represents my
              authentic learning journey.
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="helpers" className="text-sm text-muted-foreground">
              Who helped you? (optional)
            </Label>
            <Textarea
              id="helpers"
              placeholder="e.g., Discussed concepts with mentor John, used documentation from official guides..."
              value={declarationText}
              onChange={(e) => setDeclarationText(e.target.value)}
              className="min-h-[80px] resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Acknowledging guidance shows transparency and is viewed positively
              by reviewers.
            </p>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!acknowledged}>
            Submit with Declaration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
