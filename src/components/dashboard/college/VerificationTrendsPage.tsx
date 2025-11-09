import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Shield, Users, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const VerificationTrendsPage = () => {
  const { user } = useAuth();

  const { data: trendsData } = useQuery({
    queryKey: ['verification-trends', user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Get college ID
      const { data: college } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!college) return null;

      // Get student IDs from this college
      const { data: students } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('college_id', college.id);

      if (!students) return null;

      const studentIds = students.map(s => s.id);

      // Get proof uploads from last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: proofs } = await supabase
        .from('proof_uploads')
        .select('*')
        .in('student_id', studentIds)
        .gte('submitted_at', thirtyDaysAgo.toISOString());

      if (!proofs) return null;

      // Calculate trends
      const dailyData: Record<string, any> = {};
      
      proofs.forEach(proof => {
        const date = new Date(proof.submitted_at).toLocaleDateString();
        if (!dailyData[date]) {
          dailyData[date] = {
            date,
            submissions: 0,
            verified: 0,
            rejected: 0,
            avgTrustScore: 0,
            trustScores: [],
          };
        }
        dailyData[date].submissions++;
        if (proof.status === 'Verified') dailyData[date].verified++;
        if (proof.status === 'Rejected') dailyData[date].rejected++;
        if (proof.ai_score) dailyData[date].trustScores.push(proof.ai_score);
      });

      // Calculate averages
      const chartData = Object.values(dailyData).map((day: any) => ({
        ...day,
        avgTrustScore: day.trustScores.length 
          ? Math.round(day.trustScores.reduce((a: number, b: number) => a + b, 0) / day.trustScores.length)
          : 0,
      }));

      // Calculate summary stats
      const totalSubmissions = proofs.length;
      const totalVerified = proofs.filter(p => p.status === 'Verified').length;
      const totalRejected = proofs.filter(p => p.status === 'Rejected').length;
      const avgTrustScore = proofs
        .filter(p => p.ai_score)
        .reduce((sum, p) => sum + (p.ai_score || 0), 0) / proofs.filter(p => p.ai_score).length || 0;

      return {
        chartData,
        totalSubmissions,
        totalVerified,
        totalRejected,
        avgTrustScore: Math.round(avgTrustScore),
        verificationRate: totalSubmissions ? ((totalVerified / totalSubmissions) * 100).toFixed(1) : 0,
      };
    },
    enabled: !!user,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Verification Trends</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold">{trendsData?.totalSubmissions || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Verified</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="text-2xl font-bold">{trendsData?.totalVerified || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Trust Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{trendsData?.avgTrustScore || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Verification Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <span className="text-2xl font-bold">{trendsData?.verificationRate || 0}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trust Score Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Trust Score Trend (Last 30 Days)</CardTitle>
          <CardDescription>Average trust scores over time</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendsData?.chartData || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="avgTrustScore" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                name="Avg Trust Score"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Submission Status Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Submission Status</CardTitle>
          <CardDescription>Breakdown of verified vs rejected submissions</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={trendsData?.chartData || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="verified" fill="hsl(var(--primary))" name="Verified" />
              <Bar dataKey="rejected" fill="hsl(var(--destructive))" name="Rejected" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default VerificationTrendsPage;
