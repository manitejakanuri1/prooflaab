import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useMonthlyXP } from "@/hooks/useMonthlyXP";
import { useTaskStats } from "@/hooks/useTaskStats";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { TrendingUp, Target, Award, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";

const StudentProgressPage = () => {
  const { monthlyXP, loading: xpLoading } = useMonthlyXP();
  const { taskStats, loading: statsLoading } = useTaskStats();
  const { profile, loading: profileLoading } = useStudentProfile();

  if (xpLoading || statsLoading || profileLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-gray-200 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Mock data for charts - in real implementation, this would come from your data hooks
  const monthlyXPData = [
    { month: 'Jan', xp: 150 },
    { month: 'Feb', xp: 280 },
    { month: 'Mar', xp: 220 },
    { month: 'Apr', xp: 350 },
    { month: 'May', xp: 180 },
    { month: 'Jun', xp: 420 },
    { month: 'Jul', xp: monthlyXP },
  ];

  const trustScoreData = [
    { month: 'Jan', score: 65 },
    { month: 'Feb', score: 68 },
    { month: 'Mar', score: 72 },
    { month: 'Apr', score: 75 },
    { month: 'May', score: 78 },
    { month: 'Jun', score: 82 },
    { month: 'Jul', score: profile?.trust_score || 85 },
  ];

  const taskCompletionData = [
    { name: 'Completed', value: taskStats?.completedTasks || 0, color: '#22c55e' },
    { name: 'In Progress', value: taskStats?.inProgressTasks || 0, color: '#3b82f6' },
    { name: 'Pending', value: taskStats?.pendingTasks || 0, color: '#f59e0b' },
  ];

  const completionRate = taskStats?.totalTasks 
    ? Math.round((taskStats.completedTasks / taskStats.totalTasks) * 100)
    : 0;

  const progressCards = [
    {
      title: "This Month's XP",
      value: monthlyXP.toString(),
      icon: Award,
      color: "text-green-600",
      bgColor: "bg-green-50",
      change: "+15%",
      changeType: "positive"
    },
    {
      title: "Trust Score",
      value: profile?.trust_score?.toString() || "0",
      icon: TrendingUp,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      change: "+3 points",
      changeType: "positive"
    },
    {
      title: "Completion Rate",
      value: `${completionRate}%`,
      icon: Target,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      change: "+5%",
      changeType: "positive"
    },
    {
      title: "Total Tasks",
      value: taskStats?.totalTasks?.toString() || "0",
      icon: BarChart3,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
      change: "+2 this week",
      changeType: "neutral"
    },
  ];

  return (
    <div className="space-y-6">
      {/* Progress Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {progressCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index} className="transition-all hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">
                  {card.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                <div className={`text-sm ${
                  card.changeType === 'positive' ? 'text-green-600' : 
                  card.changeType === 'negative' ? 'text-red-600' : 'text-gray-600'
                }`}>
                  {card.change} from last month
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly XP Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">XP Earned Monthly</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyXPData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="xp" fill="#ea580c" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Trust Score Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Trust Score Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trustScoreData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#8b5cf6" 
                  strokeWidth={3}
                  dot={{ fill: '#8b5cf6', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Task Completion and Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task Completion Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Task Completion Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={taskCompletionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {taskCompletionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-4 mt-4">
              {taskCompletionData.map((entry, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: entry.color }}
                  ></div>
                  <span className="text-sm text-gray-600">
                    {entry.name}: {entry.value}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Progress Indicators */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Progress Indicators</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Task Completion Rate</span>
                <span className="text-sm font-bold">{completionRate}%</span>
              </div>
              <Progress value={completionRate} className="h-2" />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Trust Score</span>
                <span className="text-sm font-bold">{profile?.trust_score || 0}/100</span>
              </div>
              <Progress value={profile?.trust_score || 0} className="h-2" />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Monthly XP Goal</span>
                <span className="text-sm font-bold">{monthlyXP}/500</span>
              </div>
              <Progress value={(monthlyXP / 500) * 100} className="h-2" />
            </div>

            {/* Achievement Badges */}
            <div className="pt-4">
              <h4 className="text-sm font-medium mb-3">Recent Achievements</h4>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-yellow-100 text-yellow-800">
                  🏆 First Task Complete
                </Badge>
                <Badge className="bg-blue-100 text-blue-800">
                  🎯 Consistent Performer
                </Badge>
                <Badge className="bg-green-100 text-green-800">
                  ⭐ Quality Submitter
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default StudentProgressPage;