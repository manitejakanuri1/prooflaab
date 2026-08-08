import { Clock, Award, Shield, Trophy, Map, ListTodo, Bell, FileCheck2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useMonthlyXP } from "@/hooks/useMonthlyXP";
import { useWeeklyWorkTime } from "@/hooks/useWeeklyWorkTime";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useRecentActivity } from "@/hooks/useRecentActivity";
import { formatDistanceToNow } from "date-fns";

interface StudentDashboardOverviewProps {
  onNavigateTab?: (tab: string) => void;
}

// Everything a student needs lives behind 4 doors. Resume Check, Certification
// Radar, and Match a Job live inside Resume; the level map lives inside
// Roadmap; assigned/created/outside tasks + upload history live inside Tasks;
// notifications and coding streaks live inside Updates & Reminders.
// My Uploads/Portfolio/Feed/Settings still work, just not linked from here
// anymore. See memory: feedback-dashboard-ui-pattern.
const navCards: { id: string; label: string; description: string; icon: typeof Map }[] = [
  { id: "resume-hub", label: "Resume", description: "Resume check, certification radar, job match", icon: FileCheck2 },
  { id: "resume-roadmap", label: "Roadmap", description: "Your level-by-level path", icon: Map },
  { id: "tasks-hub", label: "Tasks", description: "Assigned, outside tasks, create your own", icon: ListTodo },
  { id: "updates-hub", label: "Updates & Reminders", description: "Notifications, coding streaks", icon: Bell },
];

const StudentDashboardOverview = ({ onNavigateTab }: StudentDashboardOverviewProps) => {
  const { profile, rank, loading: profileLoading } = useStudentProfile();
  const { monthlyXP, loading: xpLoading } = useMonthlyXP();
  const { workTime, loading: workTimeLoading } = useWeeklyWorkTime();
  const { activities, loading: activityLoading } = useRecentActivity();

  // Track user activity for work time calculation
  useActivityTracking();

  if (profileLoading || xpLoading || workTimeLoading || activityLoading) {
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

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-orange-100 to-yellow-100 dark:from-gray-800 dark:to-gray-700 p-6 rounded-2xl border border-orange-200/30 dark:border-gray-600">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
          Welcome to Your Students Dashboard
        </h1>
        <p className="text-gray-600 dark:text-gray-300">Here's your progress overview</p>
      </div>

      {/* The 3 doors — click one, it redirects there */}
      {onNavigateTab && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {navCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card
                key={card.id}
                role="button"
                tabIndex={0}
                onClick={() => onNavigateTab(card.id)}
                onKeyDown={(e) => { if (e.key === "Enter") onNavigateTab(card.id); }}
                className="bg-card border-border cursor-pointer transition-all hover:shadow-md hover:border-primary/40"
              >
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold text-foreground">{card.label}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{card.description}</p>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

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