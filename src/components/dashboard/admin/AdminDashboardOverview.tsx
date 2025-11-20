import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Building2, Rocket, ClipboardCheck, Eye, TrendingUp, Calendar, Filter } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, ComposedChart } from "recharts";

interface AdminDashboardOverviewProps {
  onNavigate?: (section: string) => void;
}

const AdminDashboardOverview = ({ onNavigate }: AdminDashboardOverviewProps) => {
  const [dateFilter, setDateFilter] = useState("7");

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

  const { data: analyticsData } = useQuery({
    queryKey: ['admin-analytics-data', dateFilter],
    queryFn: async () => {
      const daysBack = parseInt(dateFilter);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      const [signupsRes, proofsRes, collegeSignupsRes, tasksRes] = await Promise.all([
        supabase
          .from('student_profiles')
          .select('created_at')
          .gte('created_at', startDate.toISOString()),
        supabase
          .from('proof_uploads')
          .select('submitted_at')
          .gte('submitted_at', startDate.toISOString()),
        supabase
          .from('colleges')
          .select('created_at')
          .gte('created_at', startDate.toISOString()),
        supabase
          .from('tasks')
          .select('created_at, completed_at')
          .gte('created_at', startDate.toISOString())
      ]);

      // Group by day/week based on filter
      const groupSize = daysBack <= 7 ? 1 : 7;
      const periods = Math.ceil(daysBack / groupSize);
      
      return Array.from({ length: periods }, (_, i) => {
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - (periods - i) * groupSize);
        const periodEnd = new Date();
        periodEnd.setDate(periodEnd.getDate() - (periods - i - 1) * groupSize);
        
        const periodKey = periodStart.toISOString().split('T')[0];
        
        const studentSignups = signupsRes.data?.filter(s => {
          const date = new Date(s.created_at);
          return date >= periodStart && date < periodEnd;
        }).length || 0;
        
        const collegeSignups = collegeSignupsRes.data?.filter(c => {
          const date = new Date(c.created_at);
          return date >= periodStart && date < periodEnd;
        }).length || 0;
        
        const proofs = proofsRes.data?.filter(p => {
          const date = new Date(p.submitted_at);
          return date >= periodStart && date < periodEnd;
        }).length || 0;
        
        const tasksCreated = tasksRes.data?.filter(t => {
          const date = new Date(t.created_at);
          return date >= periodStart && date < periodEnd;
        }).length || 0;
        
        const tasksCompleted = tasksRes.data?.filter(t => {
          if (!t.completed_at) return false;
          const date = new Date(t.completed_at);
          return date >= periodStart && date < periodEnd;
        }).length || 0;

        return {
          date: daysBack <= 7 
            ? periodStart.toLocaleDateString('en-US', { weekday: 'short' })
            : `Week ${i + 1}`,
          studentSignups,
          collegeSignups,
          totalSignups: studentSignups + collegeSignups,
          proofs,
          tasksCreated,
          tasksCompleted
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
      color: "text-blue-600",
      onClick: () => onNavigate?.("students")
    },
    {
      title: "Active Colleges",
      value: stats?.activeColleges || 0,
      subtitle: `${stats?.totalColleges || 0} total`,
      icon: Building2,
      color: "text-green-600",
      onClick: () => onNavigate?.("colleges")
    },
    {
      title: "Active Startups",
      value: stats?.activeStartups || 0,
      subtitle: `${stats?.totalStartups || 0} total`,
      icon: Rocket,
      color: "text-purple-600",
      onClick: () => onNavigate?.("startups")
    },
    {
      title: "Pending Proofs",
      value: stats?.pendingProofs || 0,
      subtitle: `${stats?.totalProofs || 0} total submitted`,
      icon: ClipboardCheck,
      color: "text-orange-600",
      onClick: () => onNavigate?.("proof-submissions")
    },
    {
      title: "Active Tasks",
      value: stats?.activeTasks || 0,
      subtitle: `${stats?.totalTasks || 0} total posted`,
      icon: Eye,
      color: "text-teal-600",
      onClick: () => onNavigate?.("task-oversight")
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
      <div className="bg-gradient-to-r from-orange-100 to-yellow-100 dark:from-gray-800 dark:to-gray-700 p-6 rounded-2xl border border-orange-200/30 dark:border-gray-600">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Admin Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-300">Welcome to the ProofLabAI administration panel</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
        {kpiCards.map((kpi, index) => (
          <Card 
            key={index} 
            className="hover:shadow-lg transition-all cursor-pointer hover:scale-105"
            onClick={kpi.onClick}
          >
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-muted-foreground">{kpi.title}</p>
                  <p className="text-xl md:text-2xl font-bold">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground">{kpi.subtitle}</p>
                </div>
                <kpi.icon className={`h-6 w-6 md:h-8 md:w-8 ${kpi.color} flex-shrink-0`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">Time Range:</span>
        </div>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent className="bg-background border shadow-md z-50">
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 3 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <TrendingUp className="h-4 w-4 md:h-5 md:w-5" />
              Signups Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            <div className="h-48 md:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={analyticsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="studentSignups" fill="hsl(var(--primary))" name="Students" radius={4} />
                  <Bar dataKey="collegeSignups" fill="hsl(var(--secondary))" name="Colleges" radius={4} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <ClipboardCheck className="h-4 w-4 md:h-5 md:w-5" />
              Proof Submissions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            <div className="h-48 md:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analyticsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
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

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Eye className="h-4 w-4 md:h-5 md:w-5" />
              Task Lifecycle
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            <div className="h-48 md:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={analyticsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="tasksCreated" fill="hsl(var(--chart-1))" name="Created" radius={4} />
                  <Bar dataKey="tasksCompleted" fill="hsl(var(--chart-2))" name="Completed" radius={4} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboardOverview;