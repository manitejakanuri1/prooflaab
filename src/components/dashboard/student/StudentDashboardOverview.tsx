import { Clock, Award, Shield, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useAssignedTasks } from "@/hooks/useAssignedTasks";
import { useMonthlyXP } from "@/hooks/useMonthlyXP";
import { useWeeklyWorkTime } from "@/hooks/useWeeklyWorkTime";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useRecentActivity } from "@/hooks/useRecentActivity";
import { formatDistanceToNow } from "date-fns";

const StudentDashboardOverview = () => {
  const { profile, rank, loading: profileLoading } = useStudentProfile();
  const { tasks, loading: tasksLoading, startTask } = useAssignedTasks();
  const { monthlyXP, loading: xpLoading } = useMonthlyXP();
  const { workTime, loading: workTimeLoading } = useWeeklyWorkTime();
  const { activities, loading: activityLoading } = useRecentActivity();
  
  // Track user activity for work time calculation
  useActivityTracking();

  if (profileLoading || tasksLoading || xpLoading || workTimeLoading || activityLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse bg-card border-border">
              <CardHeader className="pb-2">
                <div className="h-4 bg-muted rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded w-1/2"></div>
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
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-500/10 dark:bg-blue-500/20",
    },
    {
      title: "This Month's XP",
      value: monthlyXP.toString(),
      icon: Award,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-500/10 dark:bg-green-500/20",
    },
    {
      title: "Trust Score",
      value: profile?.trust_score?.toString() || "0",
      icon: Shield,
      color: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-500/10 dark:bg-purple-500/20",
    },
    {
      title: "Leaderboard Rank",
      value: rank > 0 ? `#${rank}` : "Unranked",
      icon: Trophy,
      color: "text-orange-600 dark:text-orange-400",
      bgColor: "bg-orange-500/10 dark:bg-orange-500/20",
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border border-yellow-500/20';
      case 'In Progress':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20';
      case 'Completed':
        return 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20';
      default:
        return 'bg-muted text-muted-foreground border border-border';
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {summaryCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index} className="transition-all hover:shadow-md bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Ongoing Tasks */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Ongoing Tasks Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {ongoingTasks.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No ongoing tasks. Great job staying on top of your work! 🎉
            </p>
          ) : (
            <div className="space-y-4">
              {ongoingTasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 bg-muted/30 rounded-lg border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground text-sm sm:text-base truncate">{task.title}</h4>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-1">
                      <span className="text-xs sm:text-sm text-muted-foreground">
                        {task.due_date ? (
                          (() => {
                            const deadlineDate = new Date(task.due_date);
                            return !isNaN(deadlineDate.getTime()) 
                              ? `Due ${formatDistanceToNow(deadlineDate, { addSuffix: true })}`
                              : task.deadline || 'No due date';
                          })()
                        ) : (
                          task.deadline || 'No due date'
                        )}
                      </span>
                      <Badge className={getStatusColor(task.status)}>
                        {task.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:ml-2">
                    {task.status === 'Pending' ? (
                      <Button
                        size="sm"
                        onClick={() => startTask(task.id)}
                        className="bg-orange-600 hover:bg-orange-700 w-full sm:w-auto text-xs sm:text-sm"
                      >
                        Start Task
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-orange-500/20 text-orange-700 dark:text-orange-400 hover:bg-orange-500/10 w-full sm:w-auto text-xs sm:text-sm"
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

      {/* Recent Activity Feed */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No recent activity yet. Start working on some tasks! 💪
            </p>
          ) : (
            <div className="space-y-3">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-start space-x-3 text-sm">
                  <div className={`w-2 h-2 ${activity.color} rounded-full mt-2 flex-shrink-0`}></div>
                  <div>
                    <span className="text-foreground">{activity.message}</span>
                    <div className="text-muted-foreground text-xs">
                      {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentDashboardOverview;