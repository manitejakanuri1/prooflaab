import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Brain, MessageCircle } from "lucide-react";

interface ReflectionModalProps {
  open: boolean;
  onRequestReview: () => void;
  onSkip: () => void;
  conceptualScore?: number;
  trustScore?: number;
}

export const ReflectionModal = ({
  open,
  onRequestReview,
  onSkip,
  conceptualScore,
  trustScore,
}: ReflectionModalProps) => {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onSkip()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Brain className="h-6 w-6 text-orange-500" />
            <DialogTitle>Reflection Opportunity</DialogTitle>
          </div>
          <DialogDescription className="text-base space-y-3">
            <p>
              Your conceptual understanding seems below your usual performance.
              This happens when we're learning new concepts!
            </p>
            {conceptualScore !== undefined && (
              <p className="text-sm">
                Conceptual Score: <strong>{conceptualScore}/100</strong>
              </p>
            )}
            {trustScore !== undefined && (
              <p className="text-sm">
                Trust Score: <strong>{trustScore}/100</strong>
              </p>
            )}
            <p className="text-primary font-medium">
              Would you like to request a mentor review to strengthen your
              understanding?
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/50 rounded-lg p-4 space-y-2 my-4">
          <div className="flex items-start gap-2">
            <MessageCircle className="h-4 w-4 text-primary mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                What happens next?
              </p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Your college admin will be notified</li>
                <li>A mentor can review your understanding</li>
                <li>This shows initiative and growth mindset</li>
                <li>Your trust score receives a small boost</li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" onClick={onSkip}>
            Skip for Now
          </Button>
          <Button onClick={onRequestReview} className="gap-2">
            <Brain className="h-4 w-4" />
            Request Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
