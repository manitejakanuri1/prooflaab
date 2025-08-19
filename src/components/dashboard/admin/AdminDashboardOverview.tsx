import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, Rocket, ClipboardCheck, Eye, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const AdminDashboardOverview = () => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-overview-stats'],
    queryFn: async () => {
      const [studentsRes, collegesRes, startupsRes, proofsRes, tasksRes] = await Promise.all([
        supabase.from('student_profiles').select('id, status', { count: 'exact' }),
        supabase.from('colleges').select('id, verification_status', { count: 'exact' }),
        supabase.from('startups').select('id, verification_status', { count: 'exact' }),
        supabase.from('proof_uploads').select('id, status', { count: 'exact' }),
        supabase.from('tasks').select('id, status', { count: 'exact' })
      ]);

      return {
        totalStudents: studentsRes.count || 0,
        activeStudents: studentsRes.data?.filter(s => s.status === 'active').length || 0,
        totalColleges: collegesRes.count || 0,
        activeColleges: collegesRes.data?.filter(c => c.verification_status === 'approved').length || 0,
        totalStartups: startupsRes.count || 0,
        activeStartups: startupsRes.data?.filter(s => s.verification_status === 'approved').length || 0,
        pendingProofs: proofsRes.data?.filter(p => p.status === 'Under Review').length || 0,
        totalProofs: proofsRes.count || 0,
        activeTasks: tasksRes.data?.filter(t => t.status === 'Pending' || t.status === 'In Progress').length || 0,
        totalTasks: tasksRes.count || 0
      };
    }
  });

  const { data: weeklyData } = useQuery({
    queryKey: ['admin-weekly-data'],
    queryFn: async () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const [signupsRes, proofsRes] = await Promise.all([
        supabase
          .from('student_profiles')
          .select('created_at')
          .gte('created_at', weekAgo.toISOString()),
        supabase
          .from('proof_uploads')
          .select('submitted_at')
          .gte('submitted_at', weekAgo.toISOString())
      ]);

      // Group by day
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        return date.toISOString().split('T')[0];
      });

      return days.map(day => {
        const signups = signupsRes.data?.filter(s => 
          s.created_at?.startsWith(day)
        ).length || 0;
        
        const proofs = proofsRes.data?.filter(p => 
          p.submitted_at?.startsWith(day)
        ).length || 0;

        return {
          date: new Date(day).toLocaleDateString('en-US', { weekday: 'short' }),
          signups,
          proofs
        };
      });
    }
  });

  const kpiCards = [
    {
      title: "Total Students",
      value: stats?.totalStudents || 0,
      subtitle: `${stats?.activeStudents || 0} active`,
      icon: Users,
      color: "text-blue-600"
    },
    {
      title: "Active Colleges",
      value: stats?.activeColleges || 0,
      subtitle: `${stats?.totalColleges || 0} total`,
      icon: Building2,
      color: "text-green-600"
    },
    {
      title: "Active Startups",
      value: stats?.activeStartups || 0,
      subtitle: `${stats?.totalStartups || 0} total`,
      icon: Rocket,
      color: "text-purple-600"
    },
    {
      title: "Pending Proofs",
      value: stats?.pendingProofs || 0,
      subtitle: `${stats?.totalProofs || 0} total submitted`,
      icon: ClipboardCheck,
      color: "text-orange-600"
    },
    {
      title: "Active Tasks",
      value: stats?.activeTasks || 0,
      subtitle: `${stats?.totalTasks || 0} total posted`,
      icon: Eye,
      color: "text-teal-600"
    }
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                <div className="h-6 bg-muted rounded w-1/2 mb-1"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground">Welcome to the ProofLabAI administration panel</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {kpiCards.map((kpi, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{kpi.title}</p>
                  <p className="text-2xl font-bold">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground">{kpi.subtitle}</p>
                </div>
                <kpi.icon className={`h-8 w-8 ${kpi.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Weekly Signups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="signups" fill="hsl(var(--primary))" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Weekly Proof Submissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="proofs" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboardOverview;