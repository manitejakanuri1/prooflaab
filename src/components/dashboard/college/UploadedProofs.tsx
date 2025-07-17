import { useState } from "react";
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
import { useProofReviews, useUpdateProofStatus, useMossCheck, type ProofReview } from "@/hooks/useProofReviews";
import { CheckCircle, XCircle, Clock, FileText, ExternalLink, Microscope } from "lucide-react";
import { format } from "date-fns";

const UploadedProofs = () => {
  const { data: proofs, isLoading } = useProofReviews();
  const updateStatusMutation = useUpdateProofStatus();
  const mossMutation = useMossCheck();
  
  const [selectedProof, setSelectedProof] = useState<ProofReview | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewAction, setReviewAction] = useState<"Verified" | "Rejected" | null>(null);

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

  const getMossStatusBadge = (status: string | null, score: number | null) => {
    if (!status) return null;
    
    const colors = {
      'Unique': 'bg-green-100 text-green-800 border-green-300',
      'Similar': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'Suspicious': 'bg-red-100 text-red-800 border-red-300'
    };

    return (
      <Badge variant="outline" className={colors[status as keyof typeof colors] || ''}>
        {status} {score && `(${score}%)`}
      </Badge>
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

  const handleMossCheck = (proofId: string) => {
    mossMutation.mutate(proofId);
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Uploaded Proofs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>File/Link</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>MOSS</TableHead>
                  <TableHead>XP Reward</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proofs?.map((proof) => (
                  <TableRow key={proof.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{proof.student.full_name}</div>
                        <div className="text-sm text-muted-foreground">{proof.student.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{proof.task.title}</div>
                    </TableCell>
                    <TableCell>
                      {proof.file_url ? (
                        <a 
                          href={proof.file_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-primary hover:underline"
                        >
                          View File <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No file</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {format(new Date(proof.submitted_at), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(proof.status)}
                    </TableCell>
                    <TableCell>
                      {getMossStatusBadge(proof.moss_status, proof.moss_score)}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{proof.task.xp_reward || 0} XP</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {proof.status === 'Under Review' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReview(proof, "Verified")}
                              className="text-green-600 border-green-300 hover:bg-green-50"
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Verify
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReview(proof, "Rejected")}
                              className="text-red-600 border-red-300 hover:bg-red-50"
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </>
                        )}
                        {proof.file_url && !proof.moss_status && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleMossCheck(proof.id)}
                            disabled={mossMutation.isPending}
                            className="text-blue-600 border-blue-300 hover:bg-blue-50"
                          >
                            <Microscope className="h-3 w-3 mr-1" />
                            MOSS
                          </Button>
                        )}
                        {proof.moss_url && (
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                            className="text-purple-600 border-purple-300 hover:bg-purple-50"
                          >
                            <a href={proof.moss_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              MOSS Report
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
    </>
  );
};

export default UploadedProofs;