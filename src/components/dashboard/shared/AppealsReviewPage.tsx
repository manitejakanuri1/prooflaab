import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppealsReview, type AppealForReview } from "@/hooks/useAppealsReview";
import { useAuth } from "@/contexts/AuthContext";
import { format, isValid } from "date-fns";
import {
  Search,
  Gavel,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  MessageSquareWarning,
  Inbox,
} from "lucide-react";

interface AppealsReviewPageProps {
  userRole: "admin" | "college";
}

type StatusFilter = "pending" | "approved" | "rejected" | "all";

const safeDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  return isValid(d) ? format(d, "dd MMM yyyy, HH:mm") : "—";
};

const initials = (name?: string) =>
  (name ?? "?")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const AppealsReviewPage = ({ userRole }: AppealsReviewPageProps) => {
  const { user } = useAuth();
  const { appeals, isLoading, error, reviewAppeal } = useAppealsReview();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<AppealForReview | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [comment, setComment] = useState("");

  const counts = useMemo(() => {
    const list = appeals ?? [];
    return {
      pending: list.filter((a) => a.appeal_status === "pending").length,
      approved: list.filter((a) => a.appeal_status === "approved").length,
      rejected: list.filter((a) => a.appeal_status === "rejected").length,
      all: list.length,
    };
  }, [appeals]);

  const visible = useMemo(() => {
    let list = appeals ?? [];
    if (statusFilter !== "all") {
      list = list.filter((a) => a.appeal_status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.student_profiles?.full_name?.toLowerCase().includes(q) ||
          a.student_profiles?.email?.toLowerCase().includes(q) ||
          a.proof_uploads?.tasks?.title?.toLowerCase().includes(q) ||
          a.appeal_reason?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [appeals, statusFilter, search]);

  const openDecision = (appeal: AppealForReview, next: "approved" | "rejected") => {
    setActive(appeal);
    setDecision(next);
    setComment("");
  };

  const submitDecision = () => {
    if (!active || !decision || !user) return;
    reviewAppeal.mutate(
      {
        appealId: active.id,
        proofId: active.proof_id,
        decision,
        comment: comment.trim(),
        reviewerId: user.id,
      },
      {
        onSuccess: () => {
          setActive(null);
          setDecision(null);
          setComment("");
        },
      }
    );
  };

  const statusBadge = (status: string) => {
    if (status === "approved")
      return (
        <Badge className="bg-green-100 text-green-800 border-green-300">
          <CheckCircle className="h-3 w-3 mr-1" /> Approved
        </Badge>
      );
    if (status === "rejected")
      return (
        <Badge className="bg-red-100 text-red-800 border-red-300">
          <XCircle className="h-3 w-3 mr-1" /> Rejected
        </Badge>
      );
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-300">
        <Clock className="h-3 w-3 mr-1" /> Pending
      </Badge>
    );
  };

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-6">
          <p className="text-destructive font-medium">Could not load appeals.</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Gavel className="h-6 w-6" />
          Appeals Review
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {userRole === "admin"
            ? "Every appeal raised against a rejected proof across the platform."
            : "Appeals raised by your students against a rejected proof."}{" "}
          Approving an appeal marks the proof Verified and notifies the student.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="pending">
              Pending
              {counts.pending > 0 && (
                <span className="ml-2 rounded-full bg-amber-500 px-1.5 text-xs text-white">
                  {counts.pending}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved">Approved ({counts.approved})</TabsTrigger>
            <TabsTrigger value="rejected">Rejected ({counts.rejected})</TabsTrigger>
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search student, task or reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-32" />
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium text-foreground">
              {statusFilter === "pending"
                ? "No appeals waiting on you"
                : "Nothing here"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {statusFilter === "pending"
                ? "Students can appeal a rejected proof from My Uploads. New appeals will show up here."
                : "Try a different filter or search term."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visible.map((appeal) => (
            <Card key={appeal.id} className="bg-card border-border">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={appeal.student_profiles?.profile_photo_url ?? undefined} />
                      <AvatarFallback>
                        {initials(appeal.student_profiles?.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-base">
                        {appeal.student_profiles?.full_name ?? "Unknown student"}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {appeal.student_profiles?.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(appeal.appeal_status)}
                    <span className="text-xs text-muted-foreground">
                      {safeDate(appeal.created_at)}
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Task</p>
                    <p className="text-sm text-foreground">
                      {appeal.proof_uploads?.tasks?.title ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Proof status / AI score
                    </p>
                    <p className="text-sm text-foreground">
                      {appeal.proof_uploads?.status ?? "—"}
                      {appeal.proof_uploads?.ai_score != null &&
                        ` · ${appeal.proof_uploads.ai_score}/100`}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <MessageSquareWarning className="h-3 w-3" />
                    Why the system rejected it
                  </p>
                  <p className="text-sm text-foreground">
                    {appeal.proof_uploads?.review_comment ?? "No reviewer comment recorded."}
                  </p>
                </div>

                <div className="rounded-md border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Student's appeal
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {appeal.appeal_reason}
                  </p>
                </div>

                {appeal.appeal_status !== "pending" && appeal.reviewer_comment && (
                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Reviewer decision · {safeDate(appeal.reviewed_at)}
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {appeal.reviewer_comment}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {appeal.proof_uploads?.file_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(appeal.proof_uploads!.file_url!, "_blank")}
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      Open submission
                    </Button>
                  )}
                  {appeal.appeal_status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => openDecision(appeal, "approved")}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve appeal
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDecision(appeal, "rejected")}
                        className="border-red-300 text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject appeal
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!active && !!decision}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
            setDecision(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approved" ? "Approve this appeal?" : "Reject this appeal?"}
            </DialogTitle>
            <DialogDescription>
              {decision === "approved"
                ? "The proof will be marked Verified and the student will be notified. Your comment is stored as the override reason."
                : "The proof stays rejected. Your comment is shown to the student, so explain the reasoning."}
            </DialogDescription>
          </DialogHeader>

          <Textarea
            placeholder={
              decision === "approved"
                ? "Why this appeal succeeded (recorded as the override reason)…"
                : "Why this appeal was not accepted…"
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActive(null);
                setDecision(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={submitDecision}
              disabled={reviewAppeal.isPending || comment.trim().length === 0}
              className={
                decision === "approved" ? "bg-green-600 hover:bg-green-700 text-white" : ""
              }
              variant={decision === "rejected" ? "destructive" : "default"}
            >
              {reviewAppeal.isPending
                ? "Saving…"
                : decision === "approved"
                ? "Approve & verify proof"
                : "Reject appeal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AppealsReviewPage;
