import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { resolveProofFile, hasOpenableProof, proofFileLabel, type ProofFileRef } from "@/lib/proofFile";
import { Download, ExternalLink, FileWarning, Loader2 } from "lucide-react";

interface ProofFileButtonProps {
  proof: ProofFileRef;
  /** Download rather than open in a tab. */
  download?: boolean;
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost" | "link";
  className?: string;
}

/**
 * The one control that opens a proof.
 *
 * Uploaded proofs live in a private bucket and need a freshly signed URL, so
 * this cannot be an <a href>. Every view uses this instead of building its own
 * link, which is also what stops one page quietly rendering the old
 * "[FILE: report.pdf]" placeholder as if it were a working attachment.
 */
export const ProofFileButton = ({
  proof,
  download = false,
  label,
  size = "sm",
  variant = "outline",
  className,
}: ProofFileButtonProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  // Nothing to open. Shown rather than hidden, because a reviewer needs to know
  // the difference between "no file was attached" and "the page forgot to
  // render it".
  if (!hasOpenableProof(proof)) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}>
        <FileWarning className="h-3.5 w-3.5" />
        {proofFileLabel(proof)} — not stored
      </span>
    );
  }

  const handleClick = async () => {
    setLoading(true);
    const result = await resolveProofFile(proof);
    setLoading(false);

    if (result.error || !result.url) {
      toast({
        title: result.missing ? "No file to open" : "Couldn't open the file",
        description: result.error ?? "This submission has no attachment.",
        variant: "destructive",
      });
      return;
    }

    if (download && result.kind === "file") {
      const link = document.createElement("a");
      link.href = result.url;
      link.download = proofFileLabel(proof);
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  return (
    <Button size={size} variant={variant} onClick={handleClick} disabled={loading} className={className}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : download ? (
        <Download className="h-4 w-4" />
      ) : (
        <ExternalLink className="h-4 w-4" />
      )}
      {label ?? (download ? "Download" : "Open")}
    </Button>
  );
};

export default ProofFileButton;
