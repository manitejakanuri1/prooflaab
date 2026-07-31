import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedResumeClaim } from "@/hooks/useConfirmedResumeClaim";

interface JdMatchResult {
  jd_title: string | null;
  match_score: number;
  matched_skills: string[];
  missing_skills: string[];
  suggestions: string;
}

const StudentResumeJobMatchPage = () => {
  const { toast } = useToast();
  const { claimId, loading } = useConfirmedResumeClaim();
  const [jdText, setJdText] = useState("");
  const [matching, setMatching] = useState(false);
  const [result, setResult] = useState<JdMatchResult | null>(null);

  const handleMatch = async () => {
    if (!claimId || !jdText.trim()) return;
    setMatching(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-jd-match", {
        body: { resume_claims_id: claimId, jd_text: jdText },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult({
        jd_title: data.jd_title,
        match_score: data.match_score,
        matched_skills: data.matched_skills || [],
        missing_skills: data.missing_skills || [],
        suggestions: data.suggestions || "",
      });
    } catch (err: any) {
      toast({ title: "Couldn't check match", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setMatching(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Briefcase className="h-5 w-5" />
          Match to a job
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
              Paste a real job description to see how your confirmed resume actually matches it.
            </p>
            <Textarea value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste the job description here..." rows={6} />
            <Button onClick={handleMatch} disabled={matching || !jdText.trim()}>
              {matching ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking match...</>) : "Check match"}
            </Button>

            {result && (
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{result.jd_title || "This role"}</p>
                  <span className="text-2xl font-bold">{result.match_score}</span>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Matched</p>
                  <div className="flex flex-wrap gap-2">
                    {result.matched_skills.length > 0 ? result.matched_skills.map((s, i) => (
                      <Badge key={i} variant="secondary">{s}</Badge>
                    )) : <span className="text-sm text-muted-foreground">None found</span>}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Missing</p>
                  <div className="flex flex-wrap gap-2">
                    {result.missing_skills.length > 0 ? result.missing_skills.map((s, i) => (
                      <Badge key={i} variant="outline" className="border-destructive/40 text-destructive">{s}</Badge>
                    )) : <span className="text-sm text-muted-foreground">Nothing major</span>}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">What to do</p>
                  <p className="text-sm text-muted-foreground">{result.suggestions}</p>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StudentResumeJobMatchPage;
