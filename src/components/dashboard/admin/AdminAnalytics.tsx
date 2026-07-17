import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Download, TrendingUp, Users, Building2, FileText, Activity, Target } from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell, 
  AreaChart, 
  Area 
} from "recharts";

const AdminAnalytics = () => {
  const [dateRange, setDateRange] = useState("weekly");

  // KPI Stats Queries
  const { data: kpiStats } = useQuery({
    queryKey: ['kpi-stats', dateRange],
    queryFn: async () => {
      const now = new Date();
      const startDate = new Date();
      
      if (dateRange === "weekly") {
        startDate.setDate(now.getDate() - 7);
      } else if (dateRange === "monthly") {
        startDate.setMonth(now.getMonth() - 1);
      } else {
        startDate.setFullYear(now.getFullYear() - 1);
      }

      // Total Proofs Uploaded
      const { data: proofs } = await supabase
        .from('proof_uploads')
        .select('id')
        .gte('submitted_at', startDate.toISOString());

      // Active Students
      const { data: students } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('status', 'active');

      // Tasks Posted vs Filled
      const { data: allTasks } = await supabase
        .from('tasks')
        .select('status');
      
      const totalTasks = allTasks?.length || 0;
      const completedTasks = allTasks?.filter(t => t.status === 'Completed').length || 0;
      const fillRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      return {
        totalProofs: proofs?.length || 0,
        activeStudents: students?.length || 0,
        taskFillRate: fillRate
      };
    }
  });

  const { data: weeklyProofs } = useQuery({
    queryKey: ['weekly-proof-uploads', dateRange],
    queryFn: async () => {
      const daysCount = dateRange === "weekly" ? 7 : dateRange === "monthly" ? 30 : 365;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysCount);

      const { data } = await supabase
        .from('proof_uploads')
        .select('submitted_at')
        .gte('submitted_at', startDate.toISOString());

      const days = Array.from({ length: daysCount }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (daysCount - 1 - i));
        return date.toISOString().split('T')[0];
      });

      return days.map(day => {
        const count = data?.filter(p => p.submitted_at?.startsWith(day)).length || 0;
        return {
          date: new Date(day).toLocaleDateString('en-US', { 
            weekday: dateRange === "weekly" ? 'short' : undefined,
            month: 'short',
            day: 'numeric'
          }),
          uploads: count
        };
      }).slice(-7); // Show last 7 data points for cleaner display
    }
  });

  const { data: studentGrowth } = useQuery({
    queryKey: ['student-growth', dateRange],
    queryFn: async () => {
      const { data } = await supabase
        .from('student_profiles')
        .select('created_at')
        .order('created_at', { ascending: true });

      const monthsCount = dateRange === "weekly" ? 2 : dateRange === "monthly" ? 6 : 12;
      const monthlyData: { [key: string]: number } = {};
      
      data?.forEach(student => {
        if (student.created_at) {
          const month = new Date(student.created_at).toISOString().slice(0, 7);
          monthlyData[month] = (monthlyData[month] || 0) + 1;
        }
      });

      return Object.entries(monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-monthsCount)
        .map(([month, count]) => ({
          month: new Date(month + '-01').toLocaleDateString('en-US', { 
            month: 'short', 
            year: dateRange === "yearly" ? 'numeric' : undefined 
          }),
          students: count
        }));
    }
  });

  const { data: startupActivity } = useQuery({
    queryKey: ['startup-activity-pie'],
    queryFn: async () => {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('status');

      const statusCounts = tasks?.reduce((acc, task) => {
        acc[task.status || 'Pending'] = (acc[task.status || 'Pending'] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      return Object.entries(statusCounts).map(([status, count]) => ({
        name: status,
        value: count
      }));
    }
  });

  const exportData = (format: 'csv' | 'pdf') => {
    console.log(`Exporting data as ${format}`);
  };

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <BarChart3 className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Reports & Analytics</h1>
            <p className="text-muted-foreground">Track platform performance and insights</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportData('csv')}>
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportData('pdf')}>
              <Download className="h-4 w-4 mr-2" />
              PDF
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-primary/5 via-background to-background">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Proofs Uploaded</p>
                <p className="text-3xl font-bold text-primary">{kpiStats?.totalProofs || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <FileText className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-secondary/5 via-background to-background">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Students</p>
                <p className="text-3xl font-bold text-secondary">{kpiStats?.activeStudents || 0}</p>
              </div>
              <div className="p-3 rounded-full bg-secondary/10">
                <Users className="h-6 w-6 text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-accent/5 via-background to-background">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Tasks Fill Rate</p>
                <p className="text-3xl font-bold text-accent">{kpiStats?.taskFillRate || 0}%</p>
              </div>
              <div className="p-3 rounded-full bg-accent/10">
                <Target className="h-6 w-6 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Weekly Proof Uploads */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="p-4 md:pb-4">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Activity className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              Proof Uploads Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-64 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyProofs}>
                  <defs>
                    <linearGradient id="colorUploads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="date" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="uploads" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorUploads)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Student Growth */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-secondary" />
              Student Growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={studentGrowth}>
                  <CartesianGrid 
                    strokeDasharray="3 3" 
                    stroke="#9ca3af" 
                    strokeWidth={1}
                    opacity={1}
                  />
                  <XAxis 
                    dataKey="month" 
                    stroke="#374151"
                    fontSize={12}
                    axisLine={{ stroke: '#6b7280', strokeWidth: 2 }}
                    tickLine={{ stroke: '#6b7280', strokeWidth: 1 }}
                    tick={{ fill: '#374151' }}
                  />
                  <YAxis 
                    stroke="#374151" 
                    fontSize={12}
                    axisLine={{ stroke: '#6b7280', strokeWidth: 2 }}
                    tickLine={{ stroke: '#6b7280', strokeWidth: 1 }}
                    tick={{ fill: '#374151' }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '2px solid #d1d5db',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="students" 
                    stroke="#f59e0b" 
                    strokeWidth={3}
                    dot={{ fill: "#f59e0b", strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: "#f59e0b", strokeWidth: 2, fill: "#fbbf24" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Task Status Distribution */}
        <Card className="lg:col-span-2 border-0 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-accent" />
              Task Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={startupActivity}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={120}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {startupActivity?.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-4 mt-4">
              {startupActivity?.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-sm text-muted-foreground">{entry.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminAnalytics;