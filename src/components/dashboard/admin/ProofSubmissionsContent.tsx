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
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Eye, CheckCircle, XCircle, FileText, ExternalLink, Shield, Search } from 'lucide-react';

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
  student_profiles?: {
    full_name: string;
    email: string;
  };
  tasks?: {
    title: string;
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
            title
          )
        `);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (searchQuery) {
        query = query.or(`student_profiles.email.ilike.%${searchQuery}%,student_profiles.full_name.ilike.%${searchQuery}%,tasks.title.ilike.%${searchQuery}%`);
      }

      query = query.order(sortBy, { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      return data as ProofSubmission[];
    },
  });

  // Update submission status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, comment }: { id: string; status: string; comment?: string }) => {
      const { error } = await supabase
        .from('proof_uploads')
        .update({ 
          status, 
          review_comment: comment,
          reviewed_by: (await supabase.auth.getUser()).data.user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
      toast({
        title: 'Success',
        description: 'Submission status updated successfully',
      });
      setIsModalOpen(false);
      setReviewComment('');
    },
    onError: (error) => {
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

  const handleStatusUpdate = (status: string) => {
    if (!selectedSubmission) return;
    
    updateStatusMutation.mutate({
      id: selectedSubmission.id,
      status,
      comment: reviewComment
    });
  };

  const handleMossCheck = (submissionId: string) => {
    mossMutation.mutate(submissionId);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'Under Review': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'Verified': 'bg-green-100 text-green-800 border-green-200',
      'Rejected': 'bg-red-100 text-red-800 border-red-200',
    };
    
    return statusConfig[status as keyof typeof statusConfig] || 'bg-gray-100 text-gray-800 border-gray-200';
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
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Proof Submissions</h2>
        <p className="text-gray-600">Review and verify student task submissions</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by student email or task..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Submissions</SelectItem>
                <SelectItem value="Under Review">Under Review</SelectItem>
                <SelectItem value="Verified">Verified</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted_at">Submission Date</SelectItem>
                <SelectItem value="moss_score">MOSS Score</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-sm text-gray-500 flex items-center">
              Total: {submissions.length} submissions
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submissions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Submissions</span>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              {submissions.length} found
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No submissions found matching your criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>MOSS Result</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((submission) => (
                    <TableRow key={submission.id} className="hover:bg-gray-50">
                      <TableCell>
                        <div>
                          <div className="font-medium text-gray-900">{submission.student_profiles?.full_name}</div>
                          <div className="text-sm text-gray-500">{submission.student_profiles?.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900 max-w-xs truncate">
                          {submission.tasks?.title}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          {submission.file_url ? (
                            <FileText className="h-4 w-4 text-blue-600" />
                          ) : (
                            <ExternalLink className="h-4 w-4 text-green-600" />
                          )}
                          <span className="text-sm">{submission.file_url ? 'File' : 'Link'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-600">
                          {format(new Date(submission.submitted_at), 'MMM dd, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${getStatusBadge(submission.status)} border`}>
                          {submission.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {getMossStatusBadge(submission.moss_status, submission.moss_score)}
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReview(submission)}
                            className="h-8 w-8 p-0"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleMossCheck(submission.id)}
                            disabled={mossMutation.isPending}
                            className="h-8 w-8 p-0"
                          >
                            <Shield className="h-4 w-4" />
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
                  disabled={updateStatusMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Verify
                </Button>
                <Button
                  onClick={() => handleStatusUpdate('Rejected')}
                  disabled={updateStatusMutation.isPending}
                  variant="destructive"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
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