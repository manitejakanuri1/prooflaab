import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Search, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
}

const StudentsManagement = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const { toast } = useToast();

  const fetchStudents = async () => {
    try {
      setLoading(true);
      
      // Fetch students with task counts
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
          profile_photo_url
        `);

      if (studentsError) throw studentsError;

      // Fetch task counts for each student
      const studentsWithTaskCounts = await Promise.all(
        studentsData.map(async (student) => {
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
        description: "Failed to fetch students data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
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

    setFilteredStudents(filtered);
  }, [searchTerm, branchFilter, batchFilter, students]);

  const getTrustScoreBadge = (score: number | null) => {
    if (!score) return <Badge variant="secondary">No Score</Badge>;
    
    if (score >= 80) return <Badge className="bg-green-500 hover:bg-green-600">High ({score})</Badge>;
    if (score >= 60) return <Badge className="bg-yellow-500 hover:bg-yellow-600">Medium ({score})</Badge>;
    if (score >= 40) return <Badge className="bg-orange-500 hover:bg-orange-600">Low ({score})</Badge>;
    return <Badge variant="destructive">Very Low ({score})</Badge>;
  };

  const getStatusBadge = (student: Student) => {
    // Consider a student active if they have tasks or were created recently
    const isRecent = new Date(student.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const hasActivity = student.task_count > 0 || isRecent;
    
    return hasActivity ? 
      <Badge className="bg-green-500 hover:bg-green-600">Active</Badge> : 
      <Badge variant="secondary">Inactive</Badge>;
  };

  const uniqueBranches = [...new Set(students.map(s => s.branch).filter(Boolean))];
  const uniqueBatches = [...new Set(students.map(s => s.batch).filter(Boolean))];

  const handleViewProfile = (student: Student) => {
    setSelectedStudent(student);
    setIsProfileModalOpen(true);
  };

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
          <div className="flex flex-col sm:flex-row gap-2 md:gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-full sm:w-40 md:w-48">
                <SelectValue placeholder="Filter by Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {uniqueBranches.map(branch => (
                  <SelectItem key={branch} value={branch!}>{branch}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger className="w-full sm:w-40 md:w-48">
                <SelectValue placeholder="Filter by Batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {uniqueBatches.map(batch => (
                  <SelectItem key={batch} value={batch!}>{batch}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Students Table */}
          <div className="rounded-md border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">Name</TableHead>
                    <TableHead className="min-w-[200px]">Email</TableHead>
                    <TableHead className="min-w-[100px]">Branch</TableHead>
                    <TableHead className="min-w-[80px]">Batch</TableHead>
                    <TableHead className="min-w-[120px]">Trust Score</TableHead>
                    <TableHead className="min-w-[120px]">Tasks Assigned</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    <TableHead className="min-w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
              <TableBody>
                {filteredStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No students found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStudents.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-medium">{student.full_name}</TableCell>
                      <TableCell>{student.email}</TableCell>
                      <TableCell>{student.branch || '-'}</TableCell>
                      <TableCell>{student.batch || '-'}</TableCell>
                      <TableCell>{getTrustScoreBadge(student.trust_score)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{student.task_count} tasks</Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(student)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewProfile(student)}
                          className="h-8 w-8 p-0"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
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
    </div>
  );
};

export default StudentsManagement;