import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface SharePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  title: string;
  emojiCode: string;
  isInternal: boolean;
  isPublic: boolean;
  isOwner: boolean;
  proofId: string | null;
  externalLink: string | null;
}

export const SharePostModal = ({
  isOpen,
  onClose,
  postId,
  title,
  emojiCode,
  isInternal,
  isPublic,
  isOwner,
  proofId,
  externalLink,
}: SharePostModalProps) => {
  const [copied, setCopied] = useState(false);
  const [makingPublic, setMakingPublic] = useState(false);

  const getEmoji = (code: string) => {
    return String.fromCodePoint(parseInt(code, 16));
  };

  const handleMakePublic = async () => {
    if (!proofId) return;
    
    setMakingPublic(true);
    try {
      const { error } = await supabase.rpc('set_proof_publicity', {
        p_proof_id: proofId,
        p_is_public: true,
      });

      if (error) throw error;

      toast.success("Proof made public! You can now share it.");
      onClose();
      // Trigger page refresh to update the UI
      window.location.reload();
    } catch (error) {
      console.error('Error making proof public:', error);
      toast.error("Failed to make proof public");
    } finally {
      setMakingPublic(false);
    }
  };

  const getShareLink = () => {
    if (isInternal && isPublic) {
      return `${window.location.origin}/student/proof/${proofId}`;
    }
    if (!isInternal && externalLink) {
      return externalLink;
    }
    return "";
  };

  const handleCopyLink = () => {
    const link = getShareLink();
    if (!link) return;

    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const showMakePublicButton = isOwner && isInternal && !isPublic;
  const showShareLink = (isInternal && isPublic) || !isInternal;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Emoji Preview */}
          <div className="flex justify-center">
            <div className="bg-primary/10 rounded-xl p-6">
              <span className="text-6xl">{getEmoji(emojiCode)}</span>
            </div>
          </div>

          {/* Project Title */}
          <div className="text-center">
            <h3 className="text-xl font-bold text-foreground">{title}</h3>
          </div>

          {/* Tag */}
          <div className="flex justify-center">
            {isInternal ? (
              <Badge variant="default" className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800">
                🟢 Verified • Internal Project
              </Badge>
            ) : (
              <Badge variant="secondary" className="border">
                ⚪ Unverified • External Project
              </Badge>
            )}
          </div>

          {/* Make Public Button (for private internal proofs owned by user) */}
          {showMakePublicButton && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>This proof is private. Make it public to generate a shareable link.</p>
              </div>
              <Button 
                onClick={handleMakePublic} 
                disabled={makingPublic}
                className="w-full"
              >
                {makingPublic ? "Making Public..." : "Make Public to Share"}
              </Button>
            </div>
          )}

          {/* Shareable Link (for public internal or all external) */}
          {showShareLink && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <input
                  type="text"
                  value={getShareLink()}
                  readOnly
                  className="flex-1 bg-transparent text-sm outline-none text-foreground"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleCopyLink}
                  className="flex-shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
