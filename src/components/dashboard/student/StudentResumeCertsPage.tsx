import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Radar, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedResumeClaim } from "@/hooks/useConfirmedResumeClaim";

interface CertSuggestion {
  name: string;
  provider: string;
  priority: "high" | "medium" | "low";
  why: string;
}

const StudentResumeCertsPage = () => {
  const { toast } = useToast();
  const { claimId, loading } = useConfirmedResumeClaim();
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState<CertSuggestion[] | null>(null);

  const handleScan = async () => {
    if (!claimId) return;
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-cert-radar", {
        body: { resume_claims_id: claimId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      toast({ title: "Couldn't scan certifications", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Radar className="h-5 w-5" />
          Certification radar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="animate-pulse h-24 bg-muted rounded" />
        ) : !claimId ? (
          <p className="text-sm text-muted-foreground">Confirm your resume on the Resume Check tab first.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Real certifications worth pursuing next for your target role — skips anything you already have.
            </p>
            <Button onClick={handleScan} disabled={scanning}>
              {scanning ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...</>) : suggestions ? "Re-scan" : "Scan for certifications"}
            </Button>

            {suggestions && (
              <div className="space-y-2">
                {suggestions.length === 0 && (
                  <p className="text-sm text-muted-foreground">No gaps found — your certifications already cover this role well.</p>
                )}
                {suggestions.map((c, i) => (
                  <div key={i} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-sm">{c.name}</p>
                      <Badge
                        variant={c.priority === "high" ? "default" : "outline"}
                        className={c.priority === "high" ? "" : c.priority === "medium" ? "border-amber-400 text-amber-600" : "border-muted-foreground/40 text-muted-foreground"}
                      >
                        {c.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{c.provider}</p>
                    <p className="text-sm text-muted-foreground">{c.why}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StudentResumeCertsPage;
