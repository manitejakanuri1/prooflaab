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
      
      // Fetch student profiles with trust scores
      const { data: studentsData, error: studentsError } = await supabase
        .from('student_profiles')
        .select('id, full_name, email, trust_score, total_xp')
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
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Students</p>
                <p className="text-2xl font-bold">{stats.totalStudents}</p>
              </div>
              <Shield className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Trust (≥80)</p>
                <p className="text-2xl font-bold text-green-600">{stats.highTrust}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Average Trust</p>
                <p className="text-2xl font-bold">{stats.averageTrust}</p>
              </div>
              <Minus className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Students</p>
                <p className="text-2xl font-bold">{stats.activeStudents}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trust Scores Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Student Trust Scores & Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Trust Score</TableHead>
                  <TableHead>Total XP</TableHead>
                  <TableHead>Tasks Assigned</TableHead>
                  <TableHead>Verified Proofs</TableHead>
                  <TableHead>Performance</TableHead>
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
                          <div className="font-medium">{student.full_name}</div>
                          <div className="text-sm text-muted-foreground">{student.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getTrustScoreBadge(student.trust_score)}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{student.total_xp} XP</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{student.task_count}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          {student.verified_proofs}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-medium">
                          {getPerformanceRating(student)}
                        </span>
                        {student.task_count > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {Math.round((student.verified_proofs / student.task_count) * 100)}% completion
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrustScoresSection;