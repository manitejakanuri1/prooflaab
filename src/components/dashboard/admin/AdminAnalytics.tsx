import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, TrendingUp, Users, Building2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";

const AdminAnalytics = () => {
  const { data: weeklyProofs } = useQuery({
    queryKey: ['weekly-proof-uploads'],
    queryFn: async () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data } = await supabase
        .from('proof_uploads')
        .select('submitted_at')
        .gte('submitted_at', weekAgo.toISOString());

      const days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        return date.toISOString().split('T')[0];
      });

      return days.map(day => {
        const count = data?.filter(p => p.submitted_at?.startsWith(day)).length || 0;
        return {
          date: new Date(day).toLocaleDateString('en-US', { weekday: 'short' }),
          uploads: count
        };
      });
    }
  });

  const { data: studentGrowth } = useQuery({
    queryKey: ['student-growth-by-college'],
    queryFn: async () => {
      const { data } = await supabase
        .from('student_profiles')
        .select('created_at, batch');

      // Group by month
      const monthlyData: { [key: string]: number } = {};
      data?.forEach(student => {
        if (student.created_at) {
          const month = new Date(student.created_at).toISOString().slice(0, 7);
          monthlyData[month] = (monthlyData[month] || 0) + 1;
        }
      });

      return Object.entries(monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([month, count]) => ({
          month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          students: count
        }));
    }
  });

  const { data: startupActivity } = useQuery({
    queryKey: ['startup-activity'],
    queryFn: async () => {
      const { data: startups } = await supabase
        .from('startups')
        .select('id, name');

      const activityData = await Promise.all(
        startups?.slice(0, 5).map(async (startup) => {
          const { data: tasks } = await supabase
            .from('tasks')
            .select('id, status')
            .eq('created_by_startup_id', startup.id);

          const posted = tasks?.length || 0;
          const filled = tasks?.filter(t => t.status === 'Completed').length || 0;

          return {
            name: startup.name,
            posted,
            filled
          };
        }) || []
      );

      return activityData;
    }
  });

  const exportData = (format: 'csv' | 'pdf') => {
    // Implement export functionality
    console.log(`Exporting data as ${format}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          <h2 className="text-2xl font-bold">Reports & Analytics</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportData('csv')}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => exportData('pdf')}>
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Proof Uploads */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Weekly Proof Uploads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyProofs}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="uploads" fill="hsl(var(--primary))" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Student Growth */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Student Growth (6 Months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={studentGrowth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="students" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Startup Activity */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Startup Activity (Tasks Posted vs Filled)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={startupActivity} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} />
                  <Tooltip />
                  <Bar dataKey="posted" fill="hsl(var(--primary))" name="Posted" />
                  <Bar dataKey="filled" fill="hsl(var(--secondary))" name="Filled" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminAnalytics;