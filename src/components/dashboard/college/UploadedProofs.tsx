import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useProofReviews, useUpdateProofStatus, type ProofReview } from "@/hooks/useProofReviews";
import { useVerifyProof } from "@/hooks/useVerifyProof";
import VerificationSummaryModal from "@/components/dashboard/VerificationSummaryModal";
import VerificationDropdown from "@/components/dashboard/VerificationDropdown";
import { CheckCircle, XCircle, FileText, ExternalLink, Brain, Github, Shield } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

const UploadedProofs = () => {
  const { data: proofs, isLoading, refetch } = useProofReviews();
  const updateStatusMutation = useUpdateProofStatus();
  const verifyProofMutation = useVerifyProof();
  
  const [selectedProof, setSelectedProof] = useState<ProofReview | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewAction, setReviewAction] = useState<"Verified" | "Rejected" | null>(null);
  const [verificationModalProof, setVerificationModalProof] = useState<ProofReview | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  // Real-time subscription for proof_uploads changes
  useEffect(() => {
    const channel = supabase
      .channel('proof_uploads_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'proof_uploads'
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Verified':
        return <Badge variant="default" className="bg-green-100 text-green-800 border-green-300">Verified</Badge>;
      case 'Rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">Under Review</Badge>;
    }
  };

  const getMossScoreBadge = (score: number | null) => {
    if (score === null) return <Badge variant="outline">Not Checked</Badge>;
    
    if (score < 20) {
      return <Badge className="bg-green-100 text-green-800 border-green-300">{score}%</Badge>;
    } else if (score < 60) {
      return <Badge className="bg-orange-100 text-orange-800 border-orange-300">{score}%</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 border-red-300">{score}%</Badge>;
    }
  };

  const getOriginalityBadge = (proof: ProofReview) => {
    const score = proof.ai_verifications?.[0]?.originality_score;
    if (score === null || score === undefined) return <Badge variant="outline">-</Badge>;
    
    if (score > 70) {
      return <Badge className="bg-green-100 text-green-800">High</Badge>;
    } else if (score > 40) {
      return <Badge className="bg-orange-100 text-orange-800">Medium</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800">Low</Badge>;
    }
  };

  const getAuthenticityBadge = (proof: ProofReview) => {
    const score = proof.github_verifications?.[0]?.authenticity_score;
    if (score === null || score === undefined) return <Badge variant="outline">-</Badge>;
    
    return (
      <div className="flex items-center gap-1">
        <Github className="h-3 w-3" />
        <Badge variant="outline">{score}</Badge>
      </div>
    );
  };

  const handleReview = (proof: ProofReview, action: "Verified" | "Rejected") => {
    setSelectedProof(proof);
    setReviewAction(action);
    setReviewComment("");
  };

  const handleConfirmReview = () => {
    if (!selectedProof || !reviewAction) return;

    updateStatusMutation.mutate({
      proofId: selectedProof.id,
      status: reviewAction,
      comment: reviewComment,
      studentId: selectedProof.student_id,
      xpReward: reviewAction === 'Verified' ? selectedProof.task.xp_reward || 0 : 0
    });

    setSelectedProof(null);
    setReviewAction(null);
    setReviewComment("");
  };

  const handleRunVerification = (proofId: string) => {
    verifyProofMutation.mutate(proofId);
  };

  const handleViewResults = (proof: ProofReview) => {
    setVerificationModalProof(proof);
    setShowVerificationModal(true);
  };

  const hasVerificationResults = (proof: ProofReview) => {
    return proof.moss_score !== null || 
           proof.ai_verifications?.[0]?.originality_score !== null ||
           proof.github_verifications?.[0]?.authenticity_score !== null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Uploaded Proofs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="p-3 md:p-6">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <FileText className="h-4 w-4 md:h-5 md:w-5" />
            Uploaded Proofs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-6">
          <div className="rounded-md border overflow-x-auto -mx-3 md:mx-0">
            <div className="min-w-full inline-block align-middle">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px]">Student</TableHead>
                    <TableHead className="min-w-[150px]">Task</TableHead>
                    <TableHead className="min-w-[100px] hidden sm:table-cell">File/Link</TableHead>
                    <TableHead className="min-w-[100px] hidden md:table-cell">Submitted</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    <TableHead className="min-w-[80px] hidden lg:table-cell">MOSS</TableHead>
                    <TableHead className="min-w-[100px] hidden lg:table-cell">AI Score</TableHead>
                    <TableHead className="min-w-[100px] hidden xl:table-cell">GitHub</TableHead>
                    <TableHead className="min-w-[250px] sticky right-0 bg-background">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proofs?.map((proof) => (
                    <TableRow key={proof.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm">{proof.student.full_name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{proof.student.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{proof.task.title}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {proof.file_url ? (
                          <a 
                            href={proof.file_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline text-xs md:text-sm"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">No file</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs md:text-sm">
                        {format(new Date(proof.submitted_at), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(proof.status)}
                          {proof.admin_review_status === 'Auto-verified' && (
                            <Badge variant="outline" className="text-xs">
                              <Brain className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {getMossScoreBadge(proof.moss_score)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {getOriginalityBadge(proof)}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {getAuthenticityBadge(proof)}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-background">
                        <div className="flex gap-1 flex-wrap">
                          <VerificationDropdown
                            proofId={proof.id}
                            hasResults={hasVerificationResults(proof)}
                            onRunVerification={handleRunVerification}
                            onViewResults={() => handleViewResults(proof)}
                            isRunning={verifyProofMutation.isPending}
                          />
                          
                          {proof.status === 'Under Review' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReview(proof, "Verified")}
                                className="text-green-600 border-green-300 hover:bg-green-50 h-7 text-xs"
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                <span className="hidden sm:inline">Verify</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReview(proof, "Rejected")}
                                className="text-red-600 border-red-300 hover:bg-red-50 h-7 text-xs"
                              >
                                <XCircle className="h-3 w-3 mr-1" />
                                <span className="hidden sm:inline">Reject</span>
                              </Button>
                            </>
                          )}
                          
                          {proof.file_url && (
                            <Button
                              size="sm"
                              variant="outline"
                              asChild
                              className="h-7 text-xs"
                            >
                              <a href={proof.file_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3 mr-1" />
                                <span className="hidden sm:inline">View</span>
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {(!proofs || proofs.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  No proof submissions found.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!selectedProof} onOpenChange={() => setSelectedProof(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "Verified" ? "Verify" : "Reject"} Proof Submission
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "Verified" 
                ? `Verify ${selectedProof?.student.full_name}'s submission for "${selectedProof?.task.title}". This will award ${selectedProof?.task.xp_reward || 0} XP.`
                : `Reject ${selectedProof?.student.full_name}'s submission for "${selectedProof?.task.title}".`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="comment">Review Comment {reviewAction === "Rejected" && "(Required)"}</Label>
              <Textarea
                id="comment"
                placeholder={reviewAction === "Verified" 
                  ? "Add any feedback (optional)..." 
                  : "Please provide a reason for rejection..."
                }
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedProof(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmReview}
              disabled={reviewAction === "Rejected" && !reviewComment.trim()}
              className={reviewAction === "Verified" 
                ? "bg-green-600 hover:bg-green-700" 
                : "bg-red-600 hover:bg-red-700"
              }
            >
              {reviewAction === "Verified" ? (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Verify Submission
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject Submission
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verification Summary Modal */}
      <VerificationSummaryModal
        open={showVerificationModal}
        onOpenChange={setShowVerificationModal}
        data={verificationModalProof ? {
          moss_score: verificationModalProof.moss_score,
          moss_url: verificationModalProof.moss_url,
          originality_score: verificationModalProof.ai_verifications?.[0]?.originality_score ?? null,
          ai_summary: verificationModalProof.ai_verifications?.[0]?.ai_summary ?? null,
          ai_comments: verificationModalProof.ai_verifications?.[0]?.ai_comments ?? null,
          authenticity_score: verificationModalProof.github_verifications?.[0]?.authenticity_score ?? null,
          commit_count: verificationModalProof.github_verifications?.[0]?.commit_count ?? null,
          unique_contributors: verificationModalProof.github_verifications?.[0]?.unique_contributors ?? null,
          trust_change: null,
          status: verificationModalProof.status,
          admin_review_status: verificationModalProof.admin_review_status
        } : null}
        studentName={verificationModalProof?.student.full_name}
        taskTitle={verificationModalProof?.task.title}
      />
    </>
  );
};

export default UploadedProofs;