import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, User, Search, Filter, CheckCircle, X, RotateCcw, Mic } from "lucide-react";
import { format } from "date-fns";
import {
  useStartupSubmissions, useReviewSubmission, type CompanySubmission, type ReviewDecision,
} from "@/hooks/useStartupSubmissions";

const DECISION_LABEL: Record<ReviewDecision, string> = {
  accepted: "Accepted", needs_work: "Needs work", rejected: "Rejected",
};

const GRADE_LABEL: Record<string, string> = {
  passed: "Passed", failed: "Not passed", needs_review: "Needs review",
};

/** The student's work on this company's posted and sponsored tasks (task_submissions). */
export function StartupSubmissionsPage({ initialFilter = "all" }: { initialFilter?: string } = {}) {
  const { data: submissions = [], isLoading, error } = useStartupSubmissions();
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [open, setOpen] = useState<CompanySubmission | null>(null);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [note, setNote] = useState("");
  const review = useReviewSubmission();

  const q = searchQuery.trim().toLowerCase();
  const shown = submissions.filter((s) => {
    const matches = !q || s.task_title?.toLowerCase().includes(q) || s.student_name?.toLowerCase().includes(q);
    const state = s.review_decision ?? "unreviewed";
    return matches && (filter === "all" || filter === state);
  });

  const closeDialog = () => { setOpen(null); setDecision(null); setNote(""); };
  const save = async () => {
    if (!open || !decision) return;
    await review.mutateAsync({ submissionId: open.submission_id, decision, note: note || undefined });
    closeDialog();
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Submissions</h2>
        {[1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Submissions</h2>
          <p className="text-muted-foreground">Student work on your posted and sponsored tasks, graded automatically</p>
        </div>
        <Badge variant="outline">{shown.length} submissions</Badge>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {(error as Error).message}
        </p>
      )}

      <div className="flex flex-col gap-4 rounded-lg border bg-muted/50 p-4 sm:flex-row">
        <div className="flex flex-1 items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by task or student..." value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)} className="flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Review" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unreviewed">Not reviewed yet</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="needs_work">Needs work</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="py-12 text-center">
          <User className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">
            {submissions.length === 0 ? "No submissions yet" : "No submissions match your filters"}
          </h3>
          <p className="text-muted-foreground">
            {submissions.length === 0
              ? "Work appears here as soon as a student submits one of your tasks."
              : "Try a different search or filter."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {shown.map((s) => (
            <Card key={s.submission_id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{s.task_title}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {s.student_name}{s.college_name ? ` · ${s.college_name}` : ""} · {s.source === "sponsored" ? "Sponsored Lot" : "Posted task"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={s.status === "passed" ? "default" : "secondary"}>
                      {GRADE_LABEL[s.status] ?? s.status}{s.score != null ? ` · ${s.score}/100` : ""}
                    </Badge>
                    {s.review_decision && (
                      <Badge variant={s.review_decision === "rejected" ? "destructive" : "outline"}>
                        {DECISION_LABEL[s.review_decision]}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {s.kind === "code" && s.total_count != null && (
                  <p className="text-sm">Tests passed: <span className="font-medium">{s.passed_count ?? 0} / {s.total_count}</span>{s.language ? ` · ${s.language}` : ""}</p>
                )}
                {s.work && (
                  <pre className={`max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs ${s.kind === "code" ? "font-mono" : "font-sans"}`}>
                    {s.work}
                  </pre>
                )}
                <div className="flex items-start gap-2 text-sm">
                  <Mic className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  {s.voice_status === "scored" ? (
                    <div>
                      <span className="font-medium">Spoken explanation: {s.voice_score}/100.</span>{" "}
                      {s.voice_notes && <span className="text-muted-foreground">{s.voice_notes}</span>}
                      {s.voice_transcript && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Transcript</summary>
                          <p className="mt-1 whitespace-pre-wrap text-xs">{s.voice_transcript}</p>
                        </details>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      {s.voice_status === "pending" ? "Spoken explanation is being processed." :
                       s.voice_status === "failed" ? "Spoken explanation could not be scored." :
                       "No spoken explanation yet."}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Submitted {format(new Date(s.submitted_at), "MMM dd, yyyy")}
                    {s.attempts > 1 ? ` · attempt ${s.attempts}` : ""}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="text-destructive"
                            onClick={() => { setOpen(s); setDecision("rejected"); }}>
                      <X className="mr-1 h-4 w-4" />Reject
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setOpen(s); setDecision("needs_work"); }}>
                      <RotateCcw className="mr-1 h-4 w-4" />Needs work
                    </Button>
                    <Button size="sm" onClick={() => { setOpen(s); setDecision("accepted"); }}>
                      <CheckCircle className="mr-1 h-4 w-4" />Accept
                    </Button>
                  </div>
                </div>
                {s.review_note && <p className="text-sm text-muted-foreground">Your note: {s.review_note}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!open && !!decision} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision ? DECISION_LABEL[decision] : ""}: {open?.task_title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Student: <span className="font-medium text-foreground">{open?.student_name}</span></p>
          <div>
            <Label htmlFor="reviewNote">Note (optional)</Label>
            <Textarea id="reviewNote" value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="What was good, or what to improve" className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={() => void save()} disabled={review.isPending}>
              {review.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
