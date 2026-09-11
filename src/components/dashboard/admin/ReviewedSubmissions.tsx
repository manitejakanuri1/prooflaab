import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

interface FlaggedSubmission {
  submission_id: string;
  task_id: string;
  task_title: string;
  student_id: string;
  student_name: string;
  score: number;
  flags: string[];
  rubric_scores: { criterion_id: string; points: number; evidence: string }[] | null;
  code: string;
  created_at: string;
}

const FLAG_LABEL: Record<string, string> = {
  similar: "Close match to another student's answer",
  grader_disagreement: "The two AI graders disagreed by more than 15 points",
  ai_risk: "Flagged as possibly AI-written",
};

/**
 * Reviews task_submissions flagged needs_review (stage70) — a rubric-graded
 * answer that came back with a similarity, disagreement, or authorship flag.
 * Approve replays the same completion effects a clean pass would have had
 * (XP, task_completed, topic rating); reject marks it failed. Both go
 * through review_task_submission(), which scopes to admin or the student's
 * own approved college — the same rule EnhancedVerificationModal's
 * mayActOnStudentWork check uses for proof review.
 */
const ReviewedSubmissions = () => {
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["needs-review-submissions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("needs_review_submissions" as never);
      if (error) throw error;
      return (data ?? []) as FlaggedSubmission[];
    },
  });

  const act = async (submissionId: string, approve: boolean) => {
    setActing(submissionId);
    const { data, error } = await supabase.rpc("review_task_submission" as never, {
      _submission_id: submissionId,
      _approve: approve,
    } as never);
    setActing(null);
    const result = data as { ok: boolean; reason?: string } | null;
    if (error || !result?.ok) {
      toast.error(result?.reason === "forbidden" ? "You can't review this submission." : "Could not save your decision.");
      return;
    }
    toast.success(approve ? "Approved — XP awarded." : "Marked as not passing.");
    queryClient.invalidateQueries({ queryKey: ["needs-review-submissions"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Flagged Submissions</h2>
        <p className="text-muted-foreground">
          Written tasks (stage70) the AI grader could not clear on its own — a close match to another
          student, a disagreement between the two graders, or a possible AI-authorship flag.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Awaiting review
            <Badge variant="outline" className="ml-auto">{rows?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
            </div>
          ) : !rows || rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing waiting. Flagged submissions will show up here.
            </p>
          ) : (
            rows.map((r) => (
              <Card key={r.submission_id} className="border-blue-500/30">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.task_title}</p>
                      <p className="text-sm text-muted-foreground">{r.student_name} · score {r.score}%</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.flags.map((f) => (
                        <Badge key={f} variant="outline" className="border-blue-400/50 text-blue-600">
                          {FLAG_LABEL[f] ?? f}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Read the answer</summary>
                    <p className="mt-2 whitespace-pre-wrap rounded bg-muted p-3">{r.code}</p>
                  </details>

                  {r.rubric_scores && r.rubric_scores.length > 0 && (
                    <ul className="text-sm text-muted-foreground">
                      {r.rubric_scores.map((s) => (
                        <li key={s.criterion_id}>
                          {s.criterion_id}: {s.points} pts
                          {s.evidence && <span className="italic"> — "{s.evidence}"</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={acting === r.submission_id}
                      onClick={() => act(r.submission_id, true)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting === r.submission_id}
                      onClick={() => act(r.submission_id, false)}
                    >
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReviewedSubmissions;
