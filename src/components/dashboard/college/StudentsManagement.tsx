import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Eye, Search, Users, FileText, UserMinus, Calendar, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import StudentProfileModal from "./StudentProfileModal";

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
  status: string | null;
}

interface TaskHistoryItem {
  id: string;
  title: string;
  status: string;
  assigned_at: string;
  completed_at?: string;
}

const StudentsManagement = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [trustScoreRange, setTrustScoreRange] = useState<number[]>([0]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [taskHistoryStudent, setTaskHistoryStudent] = useState<Student | null>(null);
  const [isTaskHistoryOpen, setIsTaskHistoryOpen] = useState(false);
  const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([]);
  const { toast } = useToast();

  const fetchStudents = async () => {
    try {
      setLoading(true);
      
      // Get current college ID first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStudents([]);
        setFilteredStudents([]);
        return;
      }

      const { data: collegeData } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!collegeData) {
        setStudents([]);
        setFilteredStudents([]);
        return;
      }
      
      // Fetch students belonging to this college only
      const { data: studentsData, error: studentsError } = await supabase
        .from('student_profiles')
        .select(`
          id,
          full_name,
          email,
          branch,
          batch,
          trust_score,
          total_xp,
          created_at,
          profile_photo_url,
          college_id,
          status
        `)
        .eq('college_id', collegeData.id);

      if (studentsError) {
        console.error('Error fetching students:', studentsError);
        if (studentsError.code === 'PGRST301') {
          setStudents([]);
          setFilteredStudents([]);
          return;
        }
        throw studentsError;
      }

      // Fetch task counts for each student using tasks table
      const studentsWithTaskCounts = await Promise.all(
        (studentsData || []).map(async (student) => {
          const { data: tasks, error: tasksError } = await supabase
            .from('tasks')
            .select('id')
            .eq('student_id', student.id);

          if (tasksError) {
            console.error('Error fetching tasks for student:', student.id, tasksError);
            return { ...student, task_count: 0 };
          }

          return { ...student, task_count: tasks?.length || 0 };
        })
      );

      setStudents(studentsWithTaskCounts);
      setFilteredStudents(studentsWithTaskCounts);
    } catch (error) {
      console.error('Error fetching students:', error);
      toast({
        title: "Error",
        description: "Failed to fetch students data. Make sure students are uploaded via CSV first.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchTaskHistory = async (studentId: string) => {
    try {
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select(`
          id,
          title,
          status,
          created_at,
          completed_at
        `)
        .eq('student_id', studentId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching task history:', error);
        return;
      }

      const history: TaskHistoryItem[] = (tasks || []).map(task => ({
        id: task.id,
        title: task.title,
        status: task.status || 'Pending',
        assigned_at: task.created_at,
        completed_at: task.completed_at,
      }));

      setTaskHistory(history);
    } catch (error) {
      console.error('Error fetching task history:', error);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  useEffect(() => {
    let filtered = students;

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(student =>
        student.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.email.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply branch filter
    if (branchFilter !== "all") {
      filtered = filtered.filter(student => student.branch === branchFilter);
    }

    // Apply batch filter
    if (batchFilter !== "all") {
      filtered = filtered.filter(student => student.batch === batchFilter);
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(student => {
        const studentStatus = getStudentStatus(student);
        return studentStatus.toLowerCase() === statusFilter;
      });
    }

    // Apply trust score filter
    if (trustScoreRange[0] > 0) {
      filtered = filtered.filter(student => 
        (student.trust_score || 0) >= trustScoreRange[0]
      );
    }

    setFilteredStudents(filtered);
  }, [searchTerm, branchFilter, batchFilter, statusFilter, trustScoreRange, students]);

  const getTrustScoreBadge = (score: number | null) => {
    if (!score) return <Badge variant="secondary">No Score</Badge>;
    
    let colorClass = "";
    let label = "";
    
    if (score >= 70) {
      colorClass = "bg-green-500 hover:bg-green-600 text-white";
      label = "High";
    } else if (score >= 40) {
      colorClass = "bg-yellow-500 hover:bg-yellow-600 text-white";
      label = "Medium";
    } else {
      colorClass = "bg-red-500 hover:bg-red-600 text-white";
      label = "Low";
    }
    
    return <Badge className={colorClass}>{score}/100</Badge>;
  };

  const getStudentStatus = (student: Student): string => {
    if (student.status) {
      return student.status.charAt(0).toUpperCase() + student.status.slice(1);
    }
    
    // Fallback logic if status is not set
    const isRecent = new Date(student.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const hasActivity = student.task_count > 0 || isRecent;
    
    return hasActivity ? "Active" : "Inactive";
  };

  const getStatusBadge = (student: Student) => {
    const status = getStudentStatus(student);
    
    if (status === "Active") {
      return <Badge className="bg-green-500 hover:bg-green-600 text-white">Active</Badge>;
    } else if (status === "Alumni") {
      return <Badge className="bg-blue-500 hover:bg-blue-600 text-white">Alumni</Badge>;
    } else {
      return <Badge variant="secondary">Inactive</Badge>;
    }
  };

  const handleViewProfile = (student: Student) => {
    setSelectedStudent(student);
    setIsProfileModalOpen(true);
  };

  const handleViewTaskHistory = async (student: Student) => {
    setTaskHistoryStudent(student);
    setIsTaskHistoryOpen(true);
    await fetchTaskHistory(student.id);
  };

  const handleDeactivateStudent = async (studentId: string) => {
    try {
      const { error } = await supabase
        .from('student_profiles')
        .update({ status: 'inactive' })
        .eq('id', studentId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Student deactivated successfully",
      });

      await fetchStudents();
    } catch (error) {
      console.error('Error deactivating student:', error);
      toast({
        title: "Error",
        description: "Failed to deactivate student",
        variant: "destructive",
      });
    }
  };

  const uniqueBranches = [...new Set(students.map(s => s.branch).filter(Boolean))];
  const uniqueBatches = [...new Set(students.map(s => s.batch).filter(Boolean))];

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2">Loading students...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Students Management ({filteredStudents.length} students)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search and Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {uniqueBranches.map(branch => (
                  <SelectItem key={branch} value={branch!}>{branch}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {uniqueBatches.map(batch => (
                  <SelectItem key={batch} value={batch!}>{batch}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="alumni">Alumni</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trust Score Range Filter */}
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium min-w-fit">Trust Score Range:</span>
            <div className="flex-1 px-4">
              <Slider
                value={trustScoreRange}
                onValueChange={setTrustScoreRange}
                max={100}
                min={0}
                step={5}
                className="w-full"
              />
            </div>
            <span className="text-sm text-muted-foreground min-w-fit">
              {trustScoreRange[0]}+ points
            </span>
          </div>

          {/* Students Table */}
          <div className="rounded-md border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px]">Name</TableHead>
                    <TableHead className="min-w-[200px]">Email</TableHead>
                    <TableHead className="min-w-[100px] hidden md:table-cell">Branch</TableHead>
                    <TableHead className="min-w-[80px] hidden lg:table-cell">Batch</TableHead>
                    <TableHead className="min-w-[120px]">Trust Score</TableHead>
                    <TableHead className="min-w-[120px]">Tasks</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    <TableHead className="min-w-[100px] hidden lg:table-cell">Joined</TableHead>
                    <TableHead className="min-w-[150px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No students found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStudents.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>
                          <Button
                            variant="link"
                            className="p-0 h-auto font-medium text-left"
                            onClick={() => handleViewProfile(student)}
                          >
                            {student.full_name}
                          </Button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{student.email}</TableCell>
                        <TableCell className="hidden md:table-cell">{student.branch || '-'}</TableCell>
                        <TableCell className="hidden lg:table-cell">{student.batch || '-'}</TableCell>
                        <TableCell>{getTrustScoreBadge(student.trust_score)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewTaskHistory(student)}
                            className="h-auto p-1 font-normal"
                          >
                            <Hash className="h-3 w-3 mr-1" />
                            {student.task_count} tasks
                          </Button>
                        </TableCell>
                        <TableCell>{getStatusBadge(student)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {format(new Date(student.created_at), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewProfile(student)}
                              className="h-8 w-8 p-0"
                              title="View Profile"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewTaskHistory(student)}
                              className="h-8 w-8 p-0"
                              title="View Task History"
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeactivateStudent(student.id)}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              title="Deactivate Student"
                            >
                              <UserMinus className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Student Profile Modal */}
      <StudentProfileModal
        student={selectedStudent}
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          setSelectedStudent(null);
        }}
      />

      {/* Task History Modal */}
      <Dialog open={isTaskHistoryOpen} onOpenChange={setIsTaskHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Task History - {taskHistoryStudent?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {taskHistory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No tasks found for this student
              </div>
            ) : (
              <div className="space-y-2">
                {taskHistory.map((task) => (
                  <div key={task.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{task.title}</h4>
                      <Badge variant={task.status === 'Completed' ? 'default' : 'secondary'}>
                        {task.status}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-2">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Assigned: {format(new Date(task.assigned_at), 'MMM dd, yyyy')}
                        </span>
                        {task.completed_at && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Completed: {format(new Date(task.completed_at), 'MMM dd, yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StudentsManagement;