import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Download, ExternalLink, User, Search, Filter, CheckCircle, X } from "lucide-react";
import { useStartupSubmissions, useReviewSubmission } from "@/hooks/useStartupSubmissions";
import { format } from "date-fns";
import ProofFileButton from "@/components/proof/ProofFileButton";
import { hasOpenableProof } from "@/lib/proofFile";

export function StartupSubmissionsPage() {
  const { data: submissions = [], isLoading } = useStartupSubmissions();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const [reviewAction, setReviewAction] = useState<'verify' | 'reject' | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  
  const reviewSubmission = useReviewSubmission();

  // Filter submissions
  const filteredSubmissions = submissions.filter(submission => {
    const matchesSearch = !searchQuery.trim() || 
      submission.tasks?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      submission.student_profiles?.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      submission.student_profiles?.email.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "All" || submission.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Verified": return "default";
      case "Rejected": return "destructive";
      case "Under Review": return "secondary";
      default: return "outline";
    }
  };

  const handleReview = async (submissionId: string, status: 'Verified' | 'Rejected') => {
    await reviewSubmission.mutateAsync({
      submissionId,
      status,
      reviewComment: reviewComment || undefined,
    });
    
    setSelectedSubmission(null);
    setReviewAction(null);
    setReviewComment("");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Student Submissions</h2>
            <p className="text-muted-foreground">Review and verify student work</p>
          </div>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-muted rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Student Submissions</h2>
          <p className="text-muted-foreground">Review and verify student work</p>
        </div>
        <Badge variant="outline">
          {filteredSubmissions.length} submissions
        </Badge>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 p-4 bg-muted/50 rounded-lg border">
        <div className="flex items-center gap-2 flex-1">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by task, student name, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Status</SelectItem>
              <SelectItem value="Under Review">Under Review</SelectItem>
              <SelectItem value="Verified">Verified</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredSubmissions.length === 0 ? (
        <div className="text-center py-12">
          <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            {submissions.length === 0 ? "No submissions yet" : "No submissions match your filters"}
          </h3>
          <p className="text-muted-foreground">
            {submissions.length === 0 
              ? "Submissions will appear here when students complete your tasks."
              : "Try adjusting your search or filter criteria."
            }
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredSubmissions.map((submission) => (
            <Card key={submission.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {submission.tasks?.title || 'Unknown Task'}
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={submission.student_profiles?.profile_photo_url || ''} />
                        <AvatarFallback className="text-xs">
                          {submission.student_profiles?.full_name?.split(' ').map(n => n[0]).join('') || 'S'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-muted-foreground">
                        {submission.student_profiles?.full_name || 'Unknown Student'}
                      </span>
                    </div>
                  </div>
                  <Badge variant={getStatusColor(submission.status)}>
                    {submission.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {submission.submission_notes && (
                    <p className="text-sm">{submission.submission_notes}</p>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        Submitted {format(new Date(submission.submitted_at), 'MMM dd, yyyy')}
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        {submission.student_profiles?.email || 'No email'}
                      </div>
                      {submission.tasks?.xp_reward && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{submission.tasks.xp_reward} XP</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex gap-2">
                      {hasOpenableProof(submission) && (
                        <ProofFileButton proof={submission} label="View Proof" />
                      )}
                      
                      {submission.status === "Under Review" && (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-destructive"
                            onClick={() => {
                              setSelectedSubmission(submission);
                              setReviewAction('reject');
                            }}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                          <Button 
                            size="sm"
                            onClick={() => {
                              setSelectedSubmission(submission);
                              setReviewAction('verify');
                            }}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Verify
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!selectedSubmission && !!reviewAction} onOpenChange={() => {
        setSelectedSubmission(null);
        setReviewAction(null);
        setReviewComment("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'verify' ? 'Verify Submission' : 'Reject Submission'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Student: <span className="font-medium text-foreground">
                  {selectedSubmission?.student_profiles?.full_name}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Task: <span className="font-medium text-foreground">
                  {selectedSubmission?.tasks?.title}
                </span>
              </p>
            </div>

            {reviewAction === 'verify' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800">
                  This will mark the submission as verified and award XP to the student.
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="reviewComment">
                {reviewAction === 'verify' ? 'Review Comment (Optional)' : 'Rejection Reason'}
              </Label>
              <Textarea
                id="reviewComment"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={reviewAction === 'verify' 
                  ? "Add feedback about the submission..." 
                  : "Explain why this submission is being rejected..."
                }
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setSelectedSubmission(null);
              setReviewAction(null);
              setReviewComment("");
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => handleReview(selectedSubmission.id, reviewAction === 'verify' ? 'Verified' : 'Rejected')}
              disabled={reviewSubmission.isPending}
              className={reviewAction === 'verify' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {reviewSubmission.isPending ? 'Processing...' : 
               reviewAction === 'verify' ? 'Verify Submission' : 'Reject Submission'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}