import { Clock, Award, Shield, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useAssignedTasks } from "@/hooks/useAssignedTasks";
import { useMonthlyXP } from "@/hooks/useMonthlyXP";
import { useWeeklyWorkTime } from "@/hooks/useWeeklyWorkTime";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { formatDistanceToNow } from "date-fns";
import ProfileCardContainer from "../ProfileCardContainer";
import PortfolioCard from "../PortfolioCard";

const StudentDashboardOverview = () => {
  const { profile, rank, loading: profileLoading } = useStudentProfile();
  const { tasks, loading: tasksLoading, startTask } = useAssignedTasks();
  const { monthlyXP, loading: xpLoading } = useMonthlyXP();
  const { workTime, loading: workTimeLoading } = useWeeklyWorkTime();
  
  // Track user activity for work time calculation
  useActivityTracking();

  if (profileLoading || tasksLoading || xpLoading || workTimeLoading) {
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

  const ongoingTasks = tasks.filter(task => 
    task.status === 'In Progress' || task.status === 'Pending'
  );

  const summaryCards = [
    {
      title: "Work Time This Week",
      value: workTime,
      icon: Clock,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "This Month's XP",
      value: monthlyXP.toString(),
      icon: Award,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      title: "Trust Score",
      value: profile?.trust_score?.toString() || "0",
      icon: Shield,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "Leaderboard Rank",
      value: rank > 0 ? `#${rank}` : "Unranked",
      icon: Trophy,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800';
      case 'Completed':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile and Summary Section */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-1">
          <ProfileCardContainer />
        </div>
        
        {/* Summary Cards */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {summaryCards.map((card, index) => {
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
              </CardContent>
            </Card>
          );
        })}
        </div>
      </div>

      {/* Ongoing Tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Ongoing Tasks Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {ongoingTasks.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No ongoing tasks. Great job staying on top of your work! 🎉
            </p>
          ) : (
            <div className="space-y-4">
              {ongoingTasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">{task.title}</h4>
                    <div className="flex items-center space-x-4 mt-1">
                      <span className="text-sm text-gray-500">
                        {task.deadline ? (
                          (() => {
                            const deadlineDate = new Date(task.deadline);
                            return !isNaN(deadlineDate.getTime()) 
                              ? `Due ${formatDistanceToNow(deadlineDate, { addSuffix: true })}`
                              : 'Due date: Invalid';
                          })()
                        ) : (
                          'No due date'
                        )}
                      </span>
                      <Badge className={getStatusColor(task.status)}>
                        {task.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {task.status === 'Pending' ? (
                      <Button
                        size="sm"
                        onClick={() => startTask(task.id)}
                        className="bg-orange-600 hover:bg-orange-700"
                      >
                        Start Task
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      >
                        Continue
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Portfolio Section */}
      <PortfolioCard />

      {/* Recent Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start space-x-3 text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <span className="text-gray-900">You submitted proof for 'Build API' on July 16</span>
                <div className="text-gray-500 text-xs">2 days ago</div>
              </div>
            </div>
            <div className="flex items-start space-x-3 text-sm">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <span className="text-gray-900">Started new task 'Database Design'</span>
                <div className="text-gray-500 text-xs">3 days ago</div>
              </div>
            </div>
            <div className="flex items-start space-x-3 text-sm">
              <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <span className="text-gray-900">Earned 50 XP for completing 'React Components'</span>
                <div className="text-gray-500 text-xs">1 week ago</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentDashboardOverview;