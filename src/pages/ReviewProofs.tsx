import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Eye, CheckCircle, XCircle, FileText, ExternalLink, Shield } from 'lucide-react';

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

const ReviewProofs = () => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('submitted_at');
  const [selectedSubmission, setSelectedSubmission] = useState<ProofSubmission | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch proof submissions
  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['proof-submissions', statusFilter, sortBy],
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
      'Under Review': { variant: 'secondary' as const, color: 'bg-yellow-100 text-yellow-800' },
      'Verified': { variant: 'default' as const, color: 'bg-green-100 text-green-800' },
      'Rejected': { variant: 'destructive' as const, color: 'bg-red-100 text-red-800' },
    };
    
    return statusConfig[status as keyof typeof statusConfig] || { variant: 'outline' as const, color: '' };
  };

  const getMossStatusBadge = (status: string | null) => {
    if (!status) return null;
    
    const colors = {
      'Unique': 'bg-green-100 text-green-800',
      'Similar': 'bg-yellow-100 text-yellow-800',
      'Suspicious': 'bg-red-100 text-red-800',
      'Pending': 'bg-gray-100 text-gray-800',
    };
    
    return (
      <Badge className={colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}>
        {status}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading submissions...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Review Panel</h1>
            <p className="text-gray-600">Review and verify student task submissions</p>
          </div>
          <div className="flex items-center space-x-2">
            <Shield className="h-6 w-6 text-blue-600" />
            <span className="text-sm font-medium text-blue-600">Admin Access</span>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex space-x-4">
              <div className="flex-1">
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
              </div>
              <div className="flex-1">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitted_at">Submission Date</SelectItem>
                    <SelectItem value="student_id">Student Name</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submissions Table */}
        <Card>
          <CardHeader>
            <CardTitle>Proof Submissions ({submissions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>MOSS</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{submission.student_profiles?.full_name}</div>
                        <div className="text-sm text-gray-500">{submission.student_profiles?.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{submission.tasks?.title}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-1">
                        {submission.file_url ? <FileText className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                        <span className="text-sm">{submission.file_url ? 'File' : 'Link'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {format(new Date(submission.submitted_at), 'MMM dd, yyyy')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusBadge(submission.status).color}>
                        {submission.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {getMossStatusBadge(submission.moss_status)}
                        {submission.moss_score && (
                          <div className="text-xs text-gray-500">
                            Score: {submission.moss_score}%
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReview(submission)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleMossCheck(submission.id)}
                          disabled={mossMutation.isPending}
                        >
                          <Shield className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                    <label className="text-sm font-medium">Student</label>
                    <p className="text-sm text-gray-600">{selectedSubmission.student_profiles?.full_name}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Task</label>
                    <p className="text-sm text-gray-600">{selectedSubmission.tasks?.title}</p>
                  </div>
                </div>

                {selectedSubmission.submission_notes && (
                  <div>
                    <label className="text-sm font-medium">Student Notes</label>
                    <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                      {selectedSubmission.submission_notes}
                    </p>
                  </div>
                )}

                {selectedSubmission.file_url && (
                  <div>
                    <label className="text-sm font-medium">Submitted File</label>
                    <a 
                      href={selectedSubmission.file_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm flex items-center space-x-1"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span>View File</span>
                    </a>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">Review Comment</label>
                  <Textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Add your review comment..."
                    className="mt-1"
                  />
                </div>

                <div className="flex space-x-2">
                  <Button
                    onClick={() => handleStatusUpdate('Verified')}
                    disabled={updateStatusMutation.isPending}
                    className="bg-green-600 hover:bg-green-700"
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
    </div>
  );
};

export default ReviewProofs;