import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { User, Trophy, FileText, Calendar, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

interface Student {
  id: string;
  full_name: string;
  email: string;
  branch: string | null;
  batch: string | null;
  trust_score: number | null;
  total_xp: number | null;
  created_at: string;
  task_count: number;
  profile_photo_url: string | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  due_date: string;
  xp_reward: number | null;
}

interface ProofUpload {
  id: string;
  task_id: string;
  status: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  task_title: string;
}

interface StudentProfileModalProps {
  student: Student | null;
  isOpen: boolean;
  onClose: () => void;
}

const StudentProfileModal = ({ student, isOpen, onClose }: StudentProfileModalProps) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [proofs, setProofs] = useState<ProofUpload[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (student && isOpen) {
      fetchStudentDetails();
    }
  }, [student, isOpen]);

  const fetchStudentDetails = async () => {
    if (!student) return;

    setLoading(true);
    try {
      // Fetch tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (tasksError) throw tasksError;
      setTasks(tasksData || []);

      // Fetch proof uploads with task titles
      const { data: proofsData, error: proofsError } = await supabase
        .from('proof_uploads')
        .select(`
          *,
          tasks (title)
        `)
        .eq('student_id', student.id)
        .order('submitted_at', { ascending: false });

      if (proofsError) throw proofsError;
      
      const proofsWithTaskTitles = proofsData?.map(proof => ({
        ...proof,
        task_title: (proof as any).tasks?.title || 'Unknown Task'
      })) || [];
      
      setProofs(proofsWithTaskTitles);
    } catch (error) {
      console.error('Error fetching student details:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'in progress':
        return <Badge className="bg-blue-500 hover:bg-blue-600"><Clock className="h-3 w-3 mr-1" />In Progress</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'verified':
        return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case 'under review':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600"><Clock className="h-3 w-3 mr-1" />Under Review</Badge>;
      default:
        return <Badge variant="outline">{status || 'Unknown'}</Badge>;
    }
  };

  const getTrustScoreColor = (score: number | null) => {
    if (!score) return 'text-muted-foreground';
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  if (!student) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Student Profile</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Profile Header */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={student.profile_photo_url || ''} />
                  <AvatarFallback>
                    <User className="h-8 w-8" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold">{student.full_name}</h3>
                  <p className="text-muted-foreground">{student.email}</p>
                  <div className="flex gap-4 mt-2">
                    {student.branch && (
                      <Badge variant="outline">{student.branch}</Badge>
                    )}
                    {student.batch && (
                      <Badge variant="outline">{student.batch}</Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-yellow-500" />
                    <span className="font-semibold">{student.total_xp || 0} XP</span>
                  </div>
                  <div className={`text-sm ${getTrustScoreColor(student.trust_score)}`}>
                    Trust Score: {student.trust_score || 'N/A'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Joined: {format(new Date(student.created_at), 'MMM dd, yyyy')}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabs for detailed information */}
          <Tabs defaultValue="tasks" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="tasks" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Tasks ({tasks.length})
              </TabsTrigger>
              <TabsTrigger value="proofs" className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Proofs ({proofs.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Task History</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      <span className="ml-2">Loading tasks...</span>
                    </div>
                  ) : tasks.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No tasks assigned yet</p>
                  ) : (
                    <div className="space-y-4">
                      {tasks.map((task) => (
                        <div key={task.id} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium">{task.title}</h4>
                            {getStatusBadge(task.status)}
                          </div>
                          {task.description && (
                            <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
                          )}
                          <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Due: {format(new Date(task.due_date), 'MMM dd, yyyy')}</span>
                            <span>Reward: {task.xp_reward || 0} XP</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="proofs" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Proof Submissions</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      <span className="ml-2">Loading proofs...</span>
                    </div>
                  ) : proofs.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No proofs submitted yet</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Task</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead>Reviewed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {proofs.map((proof) => (
                          <TableRow key={proof.id}>
                            <TableCell className="font-medium">{proof.task_title}</TableCell>
                            <TableCell>{getStatusBadge(proof.status)}</TableCell>
                            <TableCell>
                              {proof.submitted_at 
                                ? format(new Date(proof.submitted_at), 'MMM dd, yyyy')
                                : '-'
                              }
                            </TableCell>
                            <TableCell>
                              {proof.reviewed_at 
                                ? format(new Date(proof.reviewed_at), 'MMM dd, yyyy')
                                : '-'
                              }
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StudentProfileModal;