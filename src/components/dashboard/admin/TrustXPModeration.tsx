import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Search, 
  Shield, 
  CheckCircle, 
  XCircle, 
  Clock, 
  TrendingUp,
  Plus,
  AlertCircle
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TrustXPModeration = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collegeFilter, setCollegeFilter] = useState("all");
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualStudent, setManualStudent] = useState("");
  const [manualTask, setManualTask] = useState("");
  const [manualXP, setManualXP] = useState(0);
  const [manualNotes, setManualNotes] = useState("");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Pending XP Reviews
  const { data: pendingReviews, isLoading: loadingPending } = useQuery({
    queryKey: ['pending-xp-reviews', statusFilter, collegeFilter],
    queryFn: async () => {
      const query = supabase
        .from('proof_uploads')
        .select(`
          *,
          student:student_profiles!inner(id, full_name, email, college_id),
          task:tasks!inner(id, title, xp_reward)
        `)
        .in('status', ['Under Review', 'Pending']);

      const { data, error } = await query.order('submitted_at', { ascending: false });
      if (error) throw error;
      
      // Fetch college names separately
      const studentIds = [...new Set(data?.map(p => p.student.college_id).filter(Boolean))];
      const { data: colleges } = await supabase
        .from('colleges')
        .select('id, name')
        .in('id', studentIds);
      
      const collegeMap = new Map(colleges?.map(c => [c.id, c.name]));
      
      let filteredData = data?.map(proof => ({
        ...proof,
        student: {
          ...proof.student,
          collegeName: collegeMap.get(proof.student.college_id) || 'N/A'
        }
      }));

      // Apply college filter
      if (collegeFilter && collegeFilter !== 'all') {
        filteredData = filteredData?.filter(proof => proof.student.college_id === collegeFilter);
      }

      return filteredData;
    }
  });

  // All Students Trust Scores
  const { data: students, isLoading: loadingStudents } = useQuery({
    queryKey: ['trust-xp-moderation', searchTerm, collegeFilter],
    queryFn: async () => {
      let query = supabase
        .from('student_profiles')
        .select('*, college_id');

      if (searchTerm) {
        query = query.or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
      }

      if (collegeFilter && collegeFilter !== 'all') {
        query = query.eq('college_id', collegeFilter);
      }

      const { data, error } = await query.order('total_xp', { ascending: false });
      if (error) throw error;
      
      // Fetch college names and verified proofs count
      const collegeIds = [...new Set(data?.map(s => s.college_id).filter(Boolean))];
      const { data: colleges } = await supabase
        .from('colleges')
        .select('id, name')
        .in('id', collegeIds);
      
      const collegeMap = new Map(colleges?.map(c => [c.id, c.name]));
      
      // Get verified proofs count for each student
      const studentsWithData = await Promise.all(
        data?.map(async (student) => {
          const { count } = await supabase
            .from('proof_uploads')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', student.id)
            .eq('status', 'Verified');
          
          return {
            ...student,
            collegeName: collegeMap.get(student.college_id) || 'N/A',
            verifiedProofsCount: count || 0
          };
        }) || []
      );
      
      return studentsWithData;
    }
  });

  // Recent Activity (XP and Trust changes)
  const { data: recentActivity, isLoading: loadingActivity } = useQuery({
    queryKey: ['recent-xp-activity'],
    queryFn: async () => {
      const { data: logs, error } = await supabase
        .from('manual_adjustment_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      
      // Fetch student details for each log
      const studentIds = logs?.map(log => log.student_id);
      const { data: students } = await supabase
        .from('student_profiles')
        .select('id, full_name, email')
        .in('id', studentIds || []);
      
      const studentMap = new Map(students?.map(s => [s.id, s]));
      
      return logs?.map(log => ({
        ...log,
        student: studentMap.get(log.student_id) || { full_name: 'Unknown', email: '' }
      }));
    }
  });

  // Colleges for filter
  const { data: colleges } = useQuery({
    queryKey: ['colleges-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('colleges')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  // Approve/Reject XP Review
  const reviewMutation = useMutation({
    mutationFn: async ({ proofId, status, xpReward, studentId }: {
      proofId: string;
      status: 'Verified' | 'Rejected';
      xpReward: number;
      studentId: string;
    }) => {
      // Update proof status
      const { error: proofError } = await supabase
        .from('proof_uploads')
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq('id', proofId);

      if (proofError) throw proofError;

      // If verified, add XP
      if (status === 'Verified' && xpReward > 0) {
        const { error: xpError } = await supabase
          .from('xp_logs')
          .insert({
            student_id: studentId,
            xp_points: xpReward,
            source: 'Task Verification'
          });

        if (xpError) throw xpError;

        // Update student total XP
        const { data: student } = await supabase
          .from('student_profiles')
          .select('total_xp')
          .eq('id', studentId)
          .single();

        const { error: updateError } = await supabase
          .from('student_profiles')
          .update({ total_xp: (student?.total_xp || 0) + xpReward })
          .eq('id', studentId);

        if (updateError) throw updateError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-xp-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['trust-xp-moderation'] });
      toast({
        title: "XP successfully updated ✅",
        description: "Student XP has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Manual XP Adjustment
  const manualMutation = useMutation({
    mutationFn: async () => {
      // Find student by email
      const { data: student, error: studentError } = await supabase
        .from('student_profiles')
        .select('id, total_xp, trust_score')
        .eq('email', manualStudent)
        .single();

      if (studentError) throw new Error('Student not found');

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Log adjustment
      const { error: logError } = await supabase
        .from('manual_adjustment_log')
        .insert({
          student_id: student.id,
          adjustment_type: manualXP >= 0 ? 'XP' : 'XP Deduction',
          amount: Math.abs(manualXP),
          reason: manualNotes,
          admin_id: user.id
        });

      if (logError) throw logError;

      // Update student XP and Trust
      const newXP = Math.max(0, student.total_xp + manualXP);
      const trustAdjustment = manualXP >= 0 ? 5 : -5;
      const newTrust = Math.min(100, Math.max(0, student.trust_score + trustAdjustment));

      const { error: updateError } = await supabase
        .from('student_profiles')
        .update({ 
          total_xp: newXP,
          trust_score: newTrust
        })
        .eq('id', student.id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trust-xp-moderation'] });
      queryClient.invalidateQueries({ queryKey: ['recent-xp-activity'] });
      toast({
        title: "XP successfully updated ✅",
        description: "Manual XP adjustment completed.",
      });
      setShowManualModal(false);
      setManualStudent("");
      setManualTask("");
      setManualXP(0);
      setManualNotes("");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleApprove = (proof: any) => {
    reviewMutation.mutate({
      proofId: proof.id,
      status: 'Verified',
      xpReward: proof.task.xp_reward || 0,
      studentId: proof.student.id
    });
  };

  const handleReject = (proof: any) => {
    reviewMutation.mutate({
      proofId: proof.id,
      status: 'Rejected',
      xpReward: 0,
      studentId: proof.student.id
    });
  };

  const isLoading = loadingPending || loadingStudents || loadingActivity;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/3 mb-6"></div>
          <div className="h-10 bg-muted rounded mb-4"></div>
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-primary/10 flex-shrink-0">
            <Shield className="h-6 w-6 md:h-8 md:w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Trust & XP Moderation</h1>
            <p className="text-sm text-muted-foreground">
              Manage and validate XP rewards, trust scores, and system-generated reputation
            </p>
          </div>
        </div>
        <Button onClick={() => setShowManualModal(true)} className="gap-2 w-full sm:w-auto" size="sm">
          <Plus className="h-4 w-4" />
          Manual Adjustment
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-lg">
        <CardContent className="pt-4 md:pt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search by student name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={collegeFilter} onValueChange={setCollegeFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="All Colleges" />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-md z-50">
                <SelectItem value="all">All Colleges</SelectItem>
                {colleges?.map((college) => (
                  <SelectItem key={college.id} value={college.id}>
                    {college.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="pending" className="space-y-4 md:space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pending" className="text-xs sm:text-sm">
            <Clock className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
            <span className="hidden sm:inline">Pending Reviews</span>
            <span className="sm:hidden">Pending</span>
          </TabsTrigger>
          <TabsTrigger value="students" className="text-xs sm:text-sm">
            <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
            <span className="hidden sm:inline">All Students</span>
            <span className="sm:hidden">Students</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm">
            <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
            <span className="hidden sm:inline">Recent Adjustments</span>
            <span className="sm:hidden">Activity</span>
          </TabsTrigger>
        </TabsList>

        {/* Pending XP Reviews */}
        <TabsContent value="pending">
          <Card className="border-0 shadow-lg">
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-base md:text-lg">Pending XP Reviews</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Student</TableHead>
                      <TableHead className="min-w-[120px]">College</TableHead>
                      <TableHead className="min-w-[150px]">Task</TableHead>
                      <TableHead>XP Awarded</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right min-w-[180px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {pendingReviews?.map((proof) => (
                    <TableRow key={proof.id}>
                      <TableCell className="font-medium">
                        {proof.student.full_name}
                        <div className="text-xs text-muted-foreground">{proof.student.email}</div>
                      </TableCell>
                      <TableCell>{proof.student.collegeName}</TableCell>
                      <TableCell>{proof.task.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {proof.task.xp_reward || 0} XP
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-orange-100 text-orange-700 border-orange-200">
                          Pending
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(proof)}
                            className="h-8 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleReject(proof)}
                            className="h-8"
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              {(!pendingReviews || pendingReviews.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  No pending reviews at the moment
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* All Students Trust Scores */}
        <TabsContent value="students">
          <Card className="border-0 shadow-lg">
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-base md:text-lg">Trust Score Overview</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Student</TableHead>
                      <TableHead className="min-w-[120px]">College</TableHead>
                      <TableHead>XP</TableHead>
                      <TableHead>Trust Score</TableHead>
                      <TableHead>Verified Proofs</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead className="text-right min-w-[120px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {students?.slice(0, 20).map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-medium">
                        {student.full_name}
                        <div className="text-xs text-muted-foreground">{student.email}</div>
                      </TableCell>
                      <TableCell>{student.collegeName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {student.total_xp || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          (student.trust_score || 0) >= 80 
                            ? 'bg-green-100 text-green-700 border-green-200'
                            : (student.trust_score || 0) >= 60 
                            ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                            : 'bg-red-100 text-red-700 border-red-200'
                        }>
                          {student.trust_score || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {student.verifiedProofsCount}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(student.updated_at).toLocaleDateString('en-GB')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => student.slug && window.open(`/portfolio/${student.slug}`, '_blank')}
                          disabled={!student.slug}
                        >
                          View Profile
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recent Activity */}
        <TabsContent value="activity">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle>Recent Activity Feed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentActivity?.map((activity) => (
                  <div 
                    key={activity.id} 
                    className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className={`p-2 rounded-lg ${
                      activity.adjustment_type.includes('Deduction') 
                        ? 'bg-red-100' 
                        : 'bg-green-100'
                    }`}>
                      {activity.adjustment_type.includes('Deduction') ? (
                        <XCircle className="h-5 w-5 text-red-600" />
                      ) : (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{activity.student.full_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(activity.created_at).toLocaleString('en-GB')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {activity.adjustment_type}: {activity.adjustment_type.includes('Deduction') ? '-' : '+'}{activity.amount} points
                      </p>
                      {activity.reason && (
                        <p className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                          Note: {activity.reason}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {(!recentActivity || recentActivity.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No recent adjustments
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manual XP Adjustment Modal */}
      <Dialog open={showManualModal} onOpenChange={setShowManualModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manual XP Adjustment</DialogTitle>
            <DialogDescription>
              Add or deduct XP for a student manually
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Student Email</Label>
              <Input
                type="email"
                placeholder="student@college.edu"
                value={manualStudent}
                onChange={(e) => setManualStudent(e.target.value)}
              />
            </div>
            <div>
              <Label>Task Title (Optional)</Label>
              <Input
                placeholder="e.g., Bonus XP for Achievement"
                value={manualTask}
                onChange={(e) => setManualTask(e.target.value)}
              />
            </div>
            <div>
              <Label>XP to Add/Deduct</Label>
              <Input
                type="number"
                placeholder="Use negative for deduction"
                value={manualXP}
                onChange={(e) => setManualXP(parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                placeholder="Reason for adjustment..."
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => manualMutation.mutate()}
              disabled={!manualStudent || manualXP === 0 || manualMutation.isPending}
            >
              {manualMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrustXPModeration;
