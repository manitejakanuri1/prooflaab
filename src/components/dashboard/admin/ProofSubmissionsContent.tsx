import React, { useState } from 'react';
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
import { format } from 'date-fns';
import { Eye, CheckCircle, XCircle, FileText, ExternalLink, Search, FileIcon, Shield } from 'lucide-react';

interface ProofSubmission {
  id: string;
  student_id: string;
  task_id: string;
  file_url: string | null;
  submission_notes: string | null;
  status: string;
  submitted_at: string;
  review_comment: string | null;
  reviewed_by: string | null;
  moss_status: string | null;
  moss_url: string | null;
  moss_score: number | null;
  review_status?: string | null;
  student_profiles?: {
    full_name: string;
    email: string;
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
            email
          ),
          tasks:task_id (
            title,
            xp_reward
          )
        `);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (searchQuery) {
        query = query.or(`student_profiles.email.ilike.%${searchQuery}%,student_profiles.full_name.ilike.%${searchQuery}%,tasks.title.ilike.%${searchQuery}%`);
      }

      query = query.order(sortBy, { ascending: false });

      const { data: proofData, error } = await query;
      if (error) throw error;

      return (proofData || []) as ProofSubmission[];
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

      // If verified, try to award XP (don't fail if XP log fails due to RLS)
      if (status === 'Verified' && xpReward && xpReward > 0) {
        try {
          // Update student total XP directly
          const { data: currentProfile } = await supabase
            .from('student_profiles')
            .select('total_xp')
            .eq('id', studentId)
            .single();

          if (currentProfile) {
            await supabase
              .from('student_profiles')
              .update({
                total_xp: (currentProfile.total_xp || 0) + xpReward
              })
              .eq('id', studentId);
          }
        } catch (xpError) {
          console.error('XP update error:', xpError);
          // Don't throw - XP update failure shouldn't prevent verification
        }
      }
      
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

  // Send to MOSS
  const mossMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const { data, error } = await supabase.functions.invoke('moss-check', {
        body: { submissionId }
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
      toast({
        title: 'MOSS Check Complete',
        description: `Plagiarism score: ${data.score}%`,
      });
    },
    onError: (error) => {
      toast({
        title: 'MOSS Check Failed',
        description: 'Failed to run plagiarism check',
        variant: 'destructive',
      });
      console.error('MOSS error:', error);
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

  const handleMossCheck = (submissionId: string) => {
    mossMutation.mutate(submissionId);
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
                    <TableHead className="font-semibold text-xs md:text-sm min-w-[200px]">Student Name + Email</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm min-w-[150px]">Task Title</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm">Submission Type</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm">Submission Date</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm">Status Badge</TableHead>
                    <TableHead className="font-semibold text-xs md:text-sm min-w-[200px]">Action Buttons</TableHead>
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
                            <div className="text-sm text-muted-foreground">{submission.student_profiles?.email}</div>
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
                          {submission.file_url ? (
                            <FileText className="h-4 w-4 text-blue-600" />
                          ) : (
                            <ExternalLink className="h-4 w-4 text-green-600" />
                          )}
                          <span className="text-sm">{submission.file_url ? 'File' : 'Link'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(submission.submitted_at), 'MMM dd, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${getStatusBadge(submission.status)} border`}>
                          {submission.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReview(submission)}
                            className="h-8 px-2 text-xs"
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            View
                          </Button>
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
                            {submission.status === 'Verified' ? 'Verified ✅' : 'Verify'}
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
                            {submission.status === 'Rejected' ? 'Rejected ❌' : 'Reject'}
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Submission</DialogTitle>
          </DialogHeader>
          
          {selectedSubmission && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Student</label>
                  <p className="text-sm text-gray-900 mt-1">{selectedSubmission.student_profiles?.full_name}</p>
                  <p className="text-xs text-gray-500">{selectedSubmission.student_profiles?.email}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Task</label>
                  <p className="text-sm text-gray-900 mt-1">{selectedSubmission.tasks?.title}</p>
                </div>
              </div>

              {selectedSubmission.submission_notes && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Student Notes</label>
                  <div className="text-sm text-gray-900 bg-gray-50 p-3 rounded-lg mt-1 border">
                    {selectedSubmission.submission_notes}
                  </div>
                </div>
              )}

              {selectedSubmission.file_url && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Submitted File</label>
                  <a 
                    href={selectedSubmission.file_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 text-sm flex items-center space-x-1 mt-1 hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span>Open File/Link</span>
                  </a>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700">Review Comment</label>
                <Textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Add your review comment..."
                  className="mt-1"
                  rows={3}
                />
              </div>

              <div className="flex space-x-2 pt-4 border-t">
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
                  onClick={() => handleMossCheck(selectedSubmission.id)}
                  disabled={mossMutation.isPending}
                  variant="outline"
                  className="border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Run MOSS Check
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProofSubmissionsContent;