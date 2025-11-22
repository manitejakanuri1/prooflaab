import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle, ExternalLink } from "lucide-react";

interface PostTypeSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectVerified: () => void;
  onSelectExternal: () => void;
}

const PostTypeSelectorModal = ({ 
  open, 
  onOpenChange,
  onSelectVerified,
  onSelectExternal 
}: PostTypeSelectorModalProps) => {
  const handleSelectVerified = () => {
    onOpenChange(false);
    onSelectVerified();
  };

  const handleSelectExternal = () => {
    onOpenChange(false);
    onSelectExternal();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Post</DialogTitle>
          <DialogDescription>
            Choose what type of post you want to create
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {/* Verified Proof Card */}
          <button
            onClick={handleSelectVerified}
            className="flex items-start gap-4 p-5 rounded-lg border border-border bg-card hover:bg-accent transition-all duration-200 hover:scale-[1.02] text-left group"
          >
            <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground mb-1">Share Verified Proof</h3>
              <p className="text-sm text-muted-foreground">
                Share a project you completed and verified on ProofLabAI
              </p>
            </div>
          </button>

          {/* External Project Card */}
          <button
            onClick={handleSelectExternal}
            className="flex items-start gap-4 p-5 rounded-lg border border-border bg-card hover:bg-accent transition-all duration-200 hover:scale-[1.02] text-left group"
          >
            <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <ExternalLink className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground mb-1">Share External Project</h3>
              <p className="text-sm text-muted-foreground">
                Share GitHub, YouTube, Figma, Drive, or any external work
              </p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PostTypeSelectorModal;
