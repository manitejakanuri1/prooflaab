import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useVerifyProof } from '@/hooks/useVerifyProof';
import { useFullVerification } from '@/hooks/useFullVerification';
import { VerificationBadges } from '@/components/dashboard/VerificationBadges';
import VerificationPanel from '@/components/dashboard/VerificationPanel';
import VerificationSummaryModal from '@/components/dashboard/VerificationSummaryModal';
import VerificationDropdown from '@/components/dashboard/VerificationDropdown';
import { format } from 'date-fns';
import ProofFileButton from '@/components/proof/ProofFileButton';
import { proofFileLabel } from '@/lib/proofFile';
import { Eye, CheckCircle, XCircle, FileText, ExternalLink, Search, FileIcon, Shield, Brain, Github, Play } from 'lucide-react';
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

interface ProofSubmission {
  id: string;
  student_id: string;
  task_id: string;
  file_url: string | null;
  file_path: string | null;
  file_name: string | null;
  submission_notes: string | null;
  status: string;
  submitted_at: string;
  review_comment: string | null;
  reviewed_by: string | null;
  admin_review_status: string | null;
  ai_score: number | null;
  ai_summary: string | null;
  ai_feedback: string | null;
  ai_status: string | null;
  github_verifications?: Array<{
    authenticity_score: number | null;
    commit_count: number | null;
    unique_contributors: number | null;
    first_commit_at: string | null;
    last_commit_at: string | null;
    largest_commit_delta: number | null;
  }>;
  ai_verifications?: Array<{
    originality_score: number | null;
    ai_authorship_risk: number | null;
    ai_summary: string | null;
    ai_comments: string | null;
  }>;
  trust_scores?: Array<{
    score: number | null;
    last_updated: string | null;
  }>;
  student_profiles?: {
    full_name: string;
    student_contact: { email: string | null } | null;
  };
  tasks?: {
    title: string;
    xp_reward?: number;
  };
}

const ProofSubmissionsContent = () => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('submitted_at');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubmission, setSelectedSubmission] = useState<ProofSubmission | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [verificationModalSubmission, setVerificationModalSubmission] = useState<ProofSubmission | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const verifyProofMutation = useVerifyProof();
  const fullVerificationMutation = useFullVerification();

  // Real-time subscription for proof_uploads changes
  // Replaces the live subscription below, which cannot work against
  // PostgREST. Paused while the tab is hidden, and refreshes at once when
  // the tab is looked at again.
  useLiveRefresh(() => { queryClient.invalidateQueries({ queryKey: ['proof-submissions'] }); });

  useEffect(() => {
    const channel = supabase
      .channel('admin_proof_uploads_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'proof_uploads'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_verifications'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'github_verifications'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conceptual_tests'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Fetch proof submissions
  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['proof-submissions', statusFilter, sortBy, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('proof_uploads')
        .select(`
          *,
          student_profiles:student_id (
            full_name,
            student_contact (email)
          ),
          tasks:task_id (
            title,
            xp_reward
          ),
          github_verifications (
            authenticity_score,
            commit_count,
            unique_contributors,
            first_commit_at,
            last_commit_at,
            largest_commit_delta
          ),
          ai_verifications (
            originality_score,
            ai_authorship_risk,
            ai_summary,
            ai_comments
          ),
          trust_scores (
            score,
            last_updated
          )
        `);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (searchQuery) {
        // email lives in student_contact now and cannot be reached from a
        // filter on the parent row.
        query = query.or(`student_profiles.full_name.ilike.%${searchQuery}%,tasks.title.ilike.%${searchQuery}%`);
      }

      query = query.order(sortBy, { ascending: false });

      const { data: proofData, error } = await query;
      if (error) throw error;

      return (proofData || []) as unknown as ProofSubmission[];
    },
  });

  // Update submission status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ 
      id, 
      status, 
      comment, 
      taskId, 
      studentId,
      xpReward 
    }: { 
      id: string; 
      status: string; 
      comment?: string;
      taskId: string;
      studentId: string;
      xpReward?: number;
    }) => {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      
      // Update proof_uploads status
      const { error: proofError } = await supabase
        .from('proof_uploads')
        .update({ 
          status, 
          review_comment: comment,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id);
      
      if (proofError) throw proofError;

      // Update task_assignments review_status
      const { error: assignmentError } = await supabase
        .from('task_assignments')
        .update({ 
          review_status: status,
          feedback: comment,
          reviewed_by: userId
        })
        .eq('task_id', taskId)
        .eq('student_id', studentId);
      
      if (assignmentError) throw assignmentError;

      // stage68: XP is paid by the on_proof_reviewed database trigger, once
      // per task, the moment the proof_uploads UPDATE above lands. The direct
      // total_xp write that used to happen here was silently reverted by
      // protect_student_profiles for anyone who is not an admin, so it never
      // actually worked for a college reviewer.

      return { id, status, taskId, studentId };
    },
    onMutate: async ({ id, status, taskId, studentId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['proof-submissions'] });
      
      // Snapshot previous value
      const previousSubmissions = queryClient.getQueryData(['proof-submissions', statusFilter, sortBy, searchQuery]);
      
      // Optimistically update - only update status field
      queryClient.setQueryData(['proof-submissions', statusFilter, sortBy, searchQuery], (old: ProofSubmission[] | undefined) => {
        if (!old) return old;
        return old.map(sub => 
          sub.id === id 
            ? { ...sub, status } 
            : sub
        );
      });
      
      return { previousSubmissions };
    },
    onSuccess: (data) => {
      // Don't invalidate - just keep the optimistic update to prevent button re-enabling
      toast({
        title: 'Success',
        description: 'Submission status updated successfully',
      });
      setIsModalOpen(false);
      setReviewComment('');
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousSubmissions) {
        queryClient.setQueryData(
          ['proof-submissions', statusFilter, sortBy, searchQuery], 
          context.previousSubmissions
        );
      }
      toast({
        title: 'Error',
        description: 'Failed to update submission status',
        variant: 'destructive',
      });
      console.error('Error updating status:', error);
    },
  });

  const handleReview = (submission: ProofSubmission) => {
    setSelectedSubmission(submission);
    setReviewComment(submission.review_comment || '');
    setIsModalOpen(true);
  };

  const handleStatusUpdate = (status: string, submission?: ProofSubmission) => {
    const sub = submission || selectedSubmission;
    if (!sub) return;
    
    updateStatusMutation.mutate({
      id: sub.id,
      status,
      comment: reviewComment,
      taskId: sub.task_id,
      studentId: sub.student_id,
      xpReward: sub.tasks?.xp_reward
    });
  };

  const handleRunVerification = (proofId: string) => {
    verifyProofMutation.mutate(proofId);
  };

  const handleRunFullVerification = (submission: ProofSubmission) => {
    const repoUrl = submission.file_url || undefined;
    fullVerificationMutation.mutate({ proofId: submission.id, repoUrl });
  };

  const handleViewVerificationResults = (submission: ProofSubmission) => {
    setVerificationModalSubmission(submission);
    setShowVerificationModal(true);
  };

  const hasVerificationResults = (submission: ProofSubmission) => {
    const hasAI = Array.isArray(submission.ai_verifications) && 
                  submission.ai_verifications.length > 0 && 
                  submission.ai_verifications[0]?.originality_score !== null;
    const hasGithub = Array.isArray(submission.github_verifications) && 
                      submission.github_verifications.length > 0 && 
                      submission.github_verifications[0]?.authenticity_score !== null;
    
    return hasAI || hasGithub;
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'Under Review': 'bg-yellow-50 text-yellow-700 border-yellow-200',
      'Verified': 'bg-green-50 text-green-700 border-green-200', 
      'Rejected': 'bg-red-50 text-red-700 border-red-200',
    };
    
    return statusConfig[status as keyof typeof statusConfig] || 'bg-muted text-muted-foreground border-border';
  };

  const getMossStatusBadge = (status: string | null, score: number | null) => {
    if (!status) return null;
    
    const getStatusInfo = () => {
      if (status === 'Error') return { color: 'bg-red-100 text-red-800 border-red-200', label: 'Error' };
      if (score !== null) {
        if (score < 30) return { color: 'bg-green-100 text-green-800 border-green-200', label: 'Unique' };
        if (score < 70) return { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Similar' };
        return { color: 'bg-red-100 text-red-800 border-red-200', label: 'Suspected' };
      }
      return { color: 'bg-gray-100 text-gray-800 border-gray-200', label: status };
    };

    const { color, label } = getStatusInfo();
    
    return (
      <div className="space-y-1">
        <Badge className={`${color} border`}>
          {label}
        </Badge>
        {score !== null && (
          <div className="text-xs text-gray-500">
            {score}%
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-32 bg-gray-200 rounded mb-6"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Proof Submissions</h2>
        </div>
        <div className="flex flex-col md:flex-row gap-2 md:gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by student name/email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-full md:w-64"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-40">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Under Review">Under Review</SelectItem>
              <SelectItem value="Verified">Verified</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full md:w-40">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="submitted_at">Latest First</SelectItem>
              <SelectItem value="created_at">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Submissions Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          {submissions.length === 0 ? (
          <div className="py-12 md:py-16 text-center">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-muted rounded-full flex items-center justify-center mb-4 mx-auto">
              <FileIcon className="h-6 w-6 md:h-8 md:w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base md:text-lg font-medium text-foreground mb-2">No submissions found</h3>
            <p className="text-sm text-muted-foreground">Encourage students to upload their proofs.</p>
          </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="font-semibold text-xs md:text-sm min-w-[200px]">Student</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm min-w-[150px]">Task</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm">Submission</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm">Date</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm">Status</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm">Verification</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm min-w-[200px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((submission) => (
                    <TableRow key={submission.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src="" />
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {submission.student_profiles?.full_name?.charAt(0)?.toUpperCase() || 'S'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-foreground">{submission.student_profiles?.full_name}</div>
                            <div className="text-sm text-muted-foreground">{submission.student_profiles?.student_contact?.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="link"
                          className="p-0 h-auto font-medium text-primary hover:text-primary/80 justify-start"
                          onClick={() => handleReview(submission)}
                        >
                          {submission.tasks?.title}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {/* Reads file_path, not file_url: an uploaded file no
                              longer writes anything into file_url, so keying off
                              that labelled every real upload as a "Link". */}
                          {submission.file_path ? (
                            <FileText className="h-4 w-4 text-blue-600" />
                          ) : (
                            <ExternalLink className="h-4 w-4 text-green-600" />
                          )}
                          <span className="text-sm">{submission.file_path ? 'File' : 'Link'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(submission.submitted_at), 'MMM dd, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge className={`${getStatusBadge(submission.status)} border`}>
                            {submission.status}
                          </Badge>
                          {submission.admin_review_status === 'Verified' && submission.ai_score !== null && (
                            <Badge variant="outline" className="text-xs">
                              <Brain className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <VerificationBadges
                          aiAuthorshipScore={submission.ai_verifications?.[0]?.originality_score}
                          commitAuthenticityScore={submission.github_verifications?.[0]?.authenticity_score}
                          conceptualScore={null}
                          cognitiveIntegrityScore={null}
                          size="sm"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          <VerificationDropdown
                            proofId={submission.id}
                            hasResults={hasVerificationResults(submission)}
                            onRunVerification={handleRunVerification}
                            onViewResults={() => handleViewVerificationResults(submission)}
                            isRunning={verifyProofMutation.isPending}
                          />
                          
                          {hasVerificationResults(submission) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewVerificationResults(submission)}
                              className="h-8 px-2 text-xs"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Results
                            </Button>
                          )}
                          
                          <Button
                            size="sm"
                            variant={submission.status === 'Verified' ? 'outline' : 'default'}
                            onClick={() => handleStatusUpdate('Verified', submission)}
                            disabled={submission.status === 'Verified' || submission.status === 'Rejected'}
                            className={`h-8 px-2 text-xs ${
                              submission.status === 'Verified' 
                                ? 'bg-green-50 text-green-700 border-green-300 cursor-not-allowed' 
                                : 'bg-green-600 hover:bg-green-700 text-white'
                            }`}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {submission.status === 'Verified' ? '✅' : 'Verify'}
                          </Button>
                          <Button
                            size="sm"
                            variant={submission.status === 'Rejected' ? 'outline' : 'destructive'}
                            onClick={() => handleStatusUpdate('Rejected', submission)}
                            disabled={submission.status === 'Verified' || submission.status === 'Rejected'}
                            className={`h-8 px-2 text-xs ${
                              submission.status === 'Rejected'
                                ? 'bg-red-50 text-red-700 border-red-300 cursor-not-allowed'
                                : ''
                            }`}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            {submission.status === 'Rejected' ? '❌' : 'Reject'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Submission</DialogTitle>
          </DialogHeader>
          
          {selectedSubmission && (
            <div className="space-y-6">
              {/* Student & Task Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Student</label>
                  <p className="text-sm text-foreground mt-1 font-medium">{selectedSubmission.student_profiles?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{selectedSubmission.student_profiles?.student_contact?.email}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Task</label>
                  <p className="text-sm text-foreground mt-1 font-medium">{selectedSubmission.tasks?.title}</p>
                  <p className="text-xs text-muted-foreground">XP Reward: {selectedSubmission.tasks?.xp_reward || 0}</p>
                </div>
              </div>

              {/* Unified Verification Panel */}
              <VerificationPanel
                aiAuthorshipRisk={
                  selectedSubmission.ai_verifications?.[0]?.ai_authorship_risk ?? 
                  (selectedSubmission.ai_verifications?.[0]?.originality_score 
                    ? 100 - selectedSubmission.ai_verifications[0].originality_score 
                    : null)
                }
                aiSummary={
                  selectedSubmission.ai_verifications?.[0]?.ai_summary ?? 
                  selectedSubmission.ai_summary
                }
                commitCount={selectedSubmission.github_verifications?.[0]?.commit_count}
                commitAuthenticityScore={selectedSubmission.github_verifications?.[0]?.authenticity_score}
                repoUrl={selectedSubmission.file_url}
                conceptualScore={null}
                trustScore={selectedSubmission.trust_scores?.[0]?.score}
                trustChange={null}
                onReVerify={() => handleRunFullVerification(selectedSubmission)}
                onViewLogs={undefined}
                isVerifying={fullVerificationMutation.isPending}
                lastCommitAt={selectedSubmission.github_verifications?.[0]?.last_commit_at}
                firstCommitAt={selectedSubmission.github_verifications?.[0]?.first_commit_at}
              />

              {selectedSubmission.submission_notes && (
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-muted-foreground">Student Notes</label>
                  <div className="text-sm text-foreground bg-muted p-3 rounded-lg mt-2 border">
                    {selectedSubmission.submission_notes}
                  </div>
                </div>
              )}

              {(selectedSubmission.file_url || selectedSubmission.file_path) && (
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-muted-foreground">Submitted File/Repo</label>
                  <p className="text-sm mt-1 break-all">{proofFileLabel(selectedSubmission)}</p>
                  <div className="flex gap-2 mt-2">
                    <ProofFileButton proof={selectedSubmission} label="Open" />
                    {selectedSubmission.file_path && (
                      <ProofFileButton proof={selectedSubmission} download label="Download" />
                    )}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <label className="text-sm font-medium text-muted-foreground">Review Comment</label>
                <Textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Add your review comment..."
                  className="mt-2"
                  rows={3}
                />
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-4 border-t">
                <Button
                  onClick={() => handleStatusUpdate('Verified')}
                  disabled={
                    updateStatusMutation.isPending || 
                    selectedSubmission.status === 'Verified' || 
                    selectedSubmission.status === 'Rejected'
                  }
                  className={
                    selectedSubmission.status === 'Verified'
                      ? 'bg-green-50 text-green-700 border-green-300'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {selectedSubmission.status === 'Verified' ? 'Verified ✅' : 'Verify'}
                </Button>
                <Button
                  onClick={() => handleStatusUpdate('Rejected')}
                  disabled={
                    updateStatusMutation.isPending || 
                    selectedSubmission.status === 'Verified' || 
                    selectedSubmission.status === 'Rejected'
                  }
                  variant={selectedSubmission.status === 'Rejected' ? 'outline' : 'destructive'}
                  className={
                    selectedSubmission.status === 'Rejected'
                      ? 'bg-red-50 text-red-700 border-red-300'
                      : ''
                  }
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {selectedSubmission.status === 'Rejected' ? 'Rejected ❌' : 'Reject'}
                </Button>
                <Button
                  onClick={() => {
                    handleRunFullVerification(selectedSubmission);
                  }}
                  disabled={fullVerificationMutation.isPending}
                  variant="outline"
                  className="border-primary/30 text-primary hover:bg-primary/10"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {fullVerificationMutation.isPending ? 'Running...' : 'Trigger Full Verification'}
                </Button>
                <Button
                  onClick={() => {
                    if (hasVerificationResults(selectedSubmission)) {
                      handleViewVerificationResults(selectedSubmission);
                    }
                  }}
                  disabled={!hasVerificationResults(selectedSubmission)}
                  variant="outline"
                  className="border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Results
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Verification Summary Modal */}
      <VerificationSummaryModal
        open={showVerificationModal}
        onOpenChange={setShowVerificationModal}
        data={verificationModalSubmission ? {
          ai_score: verificationModalSubmission.ai_score ?? (Array.isArray(verificationModalSubmission.ai_verifications) && verificationModalSubmission.ai_verifications.length > 0
            ? verificationModalSubmission.ai_verifications[0]?.originality_score ?? null
            : null),
          ai_summary: verificationModalSubmission.ai_summary ?? (Array.isArray(verificationModalSubmission.ai_verifications) && verificationModalSubmission.ai_verifications.length > 0
            ? verificationModalSubmission.ai_verifications[0]?.ai_summary ?? null
            : null),
          ai_feedback: verificationModalSubmission.ai_feedback ?? (Array.isArray(verificationModalSubmission.ai_verifications) && verificationModalSubmission.ai_verifications.length > 0
            ? verificationModalSubmission.ai_verifications[0]?.ai_comments ?? null
            : null),
          authenticity_score: Array.isArray(verificationModalSubmission.github_verifications) && verificationModalSubmission.github_verifications.length > 0
            ? verificationModalSubmission.github_verifications[0]?.authenticity_score ?? null
            : null,
          commit_count: Array.isArray(verificationModalSubmission.github_verifications) && verificationModalSubmission.github_verifications.length > 0
            ? verificationModalSubmission.github_verifications[0]?.commit_count ?? null
            : null,
          unique_contributors: Array.isArray(verificationModalSubmission.github_verifications) && verificationModalSubmission.github_verifications.length > 0
            ? verificationModalSubmission.github_verifications[0]?.unique_contributors ?? null
            : null,
          trust_change: null,
          status: verificationModalSubmission.status,
          admin_review_status: verificationModalSubmission.admin_review_status
        } : null}
        studentName={verificationModalSubmission?.student_profiles?.full_name}
        taskTitle={verificationModalSubmission?.tasks?.title}
      />
    </div>
  );
};

export default ProofSubmissionsContent;