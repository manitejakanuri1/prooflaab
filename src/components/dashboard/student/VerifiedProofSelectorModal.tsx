import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Trophy } from "lucide-react";
import { toast } from "sonner";

interface VerifiedProof {
  id: string;
  task_id: string;
  submitted_at: string;
  tasks: {
    title: string;
    xp_reward: number | null;
    xp: number | null;
  };
}

interface VerifiedProofSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProof: (proofId: string) => void;
}

const VerifiedProofSelectorModal = ({
  isOpen,
  onClose,
  onSelectProof,
}: VerifiedProofSelectorModalProps) => {
  const [proofs, setProofs] = useState<VerifiedProof[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      fetchVerifiedProofs();
    }
  }, [isOpen]);

  const fetchVerifiedProofs = async () => {
    try {
      setLoading(true);
      
      // Get current student profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please log in to continue");
        return;
      }

      const { data: profile } = await supabase
        .from("student_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!profile) {
        toast.error("Student profile not found");
        return;
      }

      // Fetch verified proofs with task details
      const { data, error } = await supabase
        .from("proof_uploads")
        .select(`
          id,
          task_id,
          submitted_at,
          tasks (
            title,
            xp_reward,
            xp
          )
        `)
        .eq("student_id", profile.id)
        .eq("status", "Verified")
        .order("submitted_at", { ascending: false });

      if (error) {
        console.error("Error fetching proofs:", error);
        toast.error("Failed to load verified proofs");
        return;
      }

      setProofs(data as VerifiedProof[]);
    } catch (error) {
      console.error("Error:", error);
      toast.error("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProof = (proofId: string) => {
    onSelectProof(proofId);
    onClose();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Select a Verified Proof to Share</DialogTitle>
          <DialogDescription>
            Choose one of your verified achievements
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading verified proofs...</div>
            </div>
          ) : proofs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Trophy className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No Verified Proofs Yet
              </h3>
              <p className="text-muted-foreground">
                You haven't completed any verified proofs yet. Complete and submit your tasks to share them here!
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
              {proofs.map((proof) => {
                const xp = proof.tasks?.xp_reward || proof.tasks?.xp || 0;
                
                return (
                  <button
                    key={proof.id}
                    onClick={() => handleSelectProof(proof.id)}
                    className="w-full flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:bg-accent transition-all duration-200 hover:scale-[1.02] text-left group"
                  >
                    {/* Icon */}
                    <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground mb-1 truncate">
                        {proof.tasks?.title || "Untitled Task"}
                      </h3>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span>Completed {formatDate(proof.submitted_at)}</span>
                        {xp > 0 && (
                          <span className="flex items-center gap-1">
                            <Trophy className="w-3 h-3" />
                            {xp} XP
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Verified Badge */}
                    <div className="flex-shrink-0">
                      <div className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-xs font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Verified
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VerifiedProofSelectorModal;
