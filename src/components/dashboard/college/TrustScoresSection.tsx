import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface StudentTrustScore {
  id: string;
  full_name: string;
  email: string;
  trust_score: number;
  total_xp: number;
  task_count: number;
  verified_proofs: number;
}

const TrustScoresSection = () => {
  const [students, setStudents] = useState<StudentTrustScore[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchTrustScores();
  }, []);

  const fetchTrustScores = async () => {
    try {
      setLoading(true);
      
      // Get current college ID first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStudents([]);
        return;
      }

      const { data: collegeData } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!collegeData) {
        setStudents([]);
        return;
      }
      
      // Fetch student profiles belonging to this college only
      const { data: studentsData, error: studentsError } = await supabase
        .from('student_profiles')
        .select('id, full_name, email, trust_score, total_xp, college_id')
        .eq('college_id', collegeData.id)
        .order('trust_score', { ascending: false });

      if (studentsError) {
        console.error('Error fetching students:', studentsError);
        if (studentsError.code === 'PGRST301') {
          setStudents([]);
          return;
        }
        throw studentsError;
      }

      // Fetch additional data for each student
      const studentsWithCounts = await Promise.all(
        studentsData.map(async (student) => {
          // Get task count
          const { data: tasks } = await supabase
            .from('tasks')
            .select('id')
            .eq('student_id', student.id);

          // Get verified proofs count
          const { data: proofs } = await supabase
            .from('proof_uploads')
            .select('id')
            .eq('student_id', student.id)
            .eq('status', 'Verified');

          return {
            ...student,
            task_count: tasks?.length || 0,
            verified_proofs: proofs?.length || 0,
          };
        })
      );

      setStudents(studentsWithCounts);
    } catch (error) {
      console.error('Error fetching trust scores:', error);
      toast({
        title: "Error",
        description: "Failed to fetch trust scores",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getTrustScoreBadge = (score: number) => {
    if (score >= 80) {
      return (
        <Badge className="bg-green-500 hover:bg-green-600 flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          High ({score})
        </Badge>
      );
    }
    if (score >= 60) {
      return (
        <Badge className="bg-blue-500 hover:bg-blue-600 flex items-center gap-1">
          <Minus className="h-3 w-3" />
          Good ({score})
        </Badge>
      );
    }
    if (score >= 40) {
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-600 flex items-center gap-1">
          <TrendingDown className="h-3 w-3" />
          Average ({score})
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <TrendingDown className="h-3 w-3" />
        Low ({score})
      </Badge>
    );
  };

  const getPerformanceRating = (student: StudentTrustScore) => {
    const completionRate = student.task_count > 0 ? (student.verified_proofs / student.task_count) * 100 : 0;
    
    if (completionRate >= 80) return "Excellent";
    if (completionRate >= 60) return "Good";
    if (completionRate >= 40) return "Average";
    return "Needs Improvement";
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Trust Scores & Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2">Loading trust scores...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = {
    totalStudents: students.length,
    highTrust: students.filter(s => s.trust_score >= 80).length,
    averageTrust: students.length > 0 ? Math.round(students.reduce((sum, s) => sum + s.trust_score, 0) / students.length) : 0,
    activeStudents: students.filter(s => s.task_count > 0).length,
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">Total Students</p>
                <p className="text-xl md:text-2xl font-bold">{stats.totalStudents}</p>
              </div>
              <Shield className="h-6 w-6 md:h-8 md:w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">High Trust (≥80)</p>
                <p className="text-xl md:text-2xl font-bold text-green-600">{stats.highTrust}</p>
              </div>
              <TrendingUp className="h-6 w-6 md:h-8 md:w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">Average Trust</p>
                <p className="text-xl md:text-2xl font-bold">{stats.averageTrust}</p>
              </div>
              <Minus className="h-6 w-6 md:h-8 md:w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">Active Students</p>
                <p className="text-xl md:text-2xl font-bold">{stats.activeStudents}</p>
              </div>
              <TrendingUp className="h-6 w-6 md:h-8 md:w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trust Scores Table */}
      <Card>
        <CardHeader className="p-3 md:p-6">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Shield className="h-4 w-4 md:h-5 md:w-5" />
            Student Trust Scores & Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-6">
          <div className="rounded-md border overflow-x-auto -mx-3 md:mx-0">
            <div className="min-w-full inline-block align-middle">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px]">Student</TableHead>
                    <TableHead className="min-w-[120px]">Trust Score</TableHead>
                    <TableHead className="min-w-[80px] hidden sm:table-cell">Total XP</TableHead>
                    <TableHead className="min-w-[100px] hidden md:table-cell">Tasks Assigned</TableHead>
                    <TableHead className="min-w-[120px] hidden md:table-cell">Verified Proofs</TableHead>
                    <TableHead className="min-w-[120px]">Performance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No students found
                      </TableCell>
                    </TableRow>
                  ) : (
                    students.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium text-sm">{student.full_name}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[150px]">{student.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {getTrustScoreBadge(student.trust_score)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className="font-medium text-sm">{student.total_xp} XP</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline" className="text-xs">{student.task_count}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                            {student.verified_proofs}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs md:text-sm font-medium">
                            {getPerformanceRating(student)}
                          </span>
                          {student.task_count > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {Math.round((student.verified_proofs / student.task_count) * 100)}%
                            </div>
                          )}
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
    </div>
  );
};

export default TrustScoresSection;