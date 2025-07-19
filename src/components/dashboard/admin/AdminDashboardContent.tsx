import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  TestTube,
  BarChart3,
  Users,
  Building,
  Eye,
  AlertTriangle
} from "lucide-react";
import { useAdminDashboardStats, useRecentSubmissions, usePendingReviewsCount } from "@/hooks/useAdminDashboard";
import { format } from "date-fns";

interface AdminDashboardContentProps {
  onTabChange: (tab: string) => void;
}

const AdminDashboardContent = ({ onTabChange }: AdminDashboardContentProps) => {
  const { data: stats, isLoading: statsLoading } = useAdminDashboardStats();
  const { data: recentSubmissions, isLoading: submissionsLoading } = useRecentSubmissions();
  const { data: pendingCount, isLoading: pendingLoading } = usePendingReviewsCount();

  const summaryCards = [
    {
      title: "Total Submissions",
      value: stats?.totalSubmissions || 0,
      icon: FileText,
      iconColor: "text-blue-600",
      bgColor: "bg-blue-100",
      emoji: "📥"
    },
    {
      title: "Verified Submissions",
      value: stats?.verifiedSubmissions || 0,
      icon: CheckCircle,
      iconColor: "text-green-600",
      bgColor: "bg-green-100",
      emoji: "✅"
    },
    {
      title: "Rejected Submissions",
      value: stats?.rejectedSubmissions || 0,
      icon: XCircle,
      iconColor: "text-red-600",
      bgColor: "bg-red-100",
      emoji: "❌"
    },
    {
      title: "Pending Reviews",
      value: stats?.pendingReviews || 0,
      icon: Clock,
      iconColor: "text-yellow-600",
      bgColor: "bg-yellow-100",
      emoji: "🕒"
    }
  ];

  const insightCards = [
    {
      title: "MOSS Submissions",
      value: stats?.mossSubmissions || 0,
      icon: TestTube,
      iconColor: "text-purple-600",
      bgColor: "bg-purple-100",
      emoji: "🧪"
    },
    {
      title: "Avg MOSS Score",
      value: `${stats?.averageMossScore || 0}%`,
      icon: BarChart3,
      iconColor: "text-indigo-600",
      bgColor: "bg-indigo-100",
      emoji: "📊"
    },
    {
      title: "Active Students (7d)",
      value: stats?.activeStudentsThisWeek || 0,
      icon: Users,
      iconColor: "text-orange-600",
      bgColor: "bg-orange-100",
      emoji: "👥"
    },
    {
      title: "Top College",
      value: stats?.topCollege || "No Data",
      icon: Building,
      iconColor: "text-teal-600",
      bgColor: "bg-teal-100",
      emoji: "🏛️",
      isText: true
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Verified':
        return <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100">Verified</Badge>;
      case 'Rejected':
        return <Badge variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-100">Rejected</Badge>;
      case 'Under Review':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Under Review</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (statsLoading || submissionsLoading || pendingLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-64 mb-6"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-100 to-indigo-100 p-6 rounded-2xl border border-blue-200/30">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          Admin Dashboard
        </h2>
        <p className="text-gray-600">
          Monitor platform activity, review submissions, and track student engagement.
        </p>
      </div>

      {/* Summary Cards - Row 1 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">📋 Submission Overview</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {summaryCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <Card key={index} className="border border-gray-200/50 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4 md:p-6">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs md:text-sm font-medium text-gray-600 mb-1 truncate">
                        {card.emoji} {card.title}
                      </p>
                      <p className="text-xl md:text-3xl font-bold text-gray-900">
                        {card.value}
                      </p>
                    </div>
                    <div className={`p-2 md:p-3 rounded-lg ${card.bgColor} flex-shrink-0`}>
                      <Icon className={`h-4 w-4 md:h-6 md:w-6 ${card.iconColor}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Insight Cards - Row 2 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Platform Insights</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {insightCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <Card key={index} className="border border-gray-200/50 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4 md:p-6">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs md:text-sm font-medium text-gray-600 mb-1 truncate">
                        {card.emoji} {card.title}
                      </p>
                      <p className={`${card.isText ? 'text-sm md:text-lg' : 'text-xl md:text-3xl'} font-bold text-gray-900 ${card.isText ? 'truncate' : ''}`}>
                        {card.value}
                      </p>
                    </div>
                    <div className={`p-2 md:p-3 rounded-lg ${card.bgColor} flex-shrink-0`}>
                      <Icon className={`h-4 w-4 md:h-6 md:w-6 ${card.iconColor}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Widgets Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Latest Submissions */}
        <Card className="border border-gray-200/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-semibold">📋 Latest Submissions</CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => onTabChange('proof-submissions')}
            >
              <Eye className="h-4 w-4 mr-2" />
              View All
            </Button>
          </CardHeader>
          <CardContent>
            {recentSubmissions && recentSubmissions.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Task</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentSubmissions.map((submission, index) => (
                      <TableRow key={index}>
                        <TableCell className="text-sm font-medium">
                          {submission.student_email}
                        </TableCell>
                        <TableCell className="text-sm truncate max-w-32">
                          {submission.task_title}
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">
                          {format(new Date(submission.submitted_at), 'MMM dd')}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(submission.status)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No submissions yet</p>
            )}
          </CardContent>
        </Card>

        {/* Review Queue Reminder */}
        <Card className="border border-gray-200/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-orange-500" />
              Review Queue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-orange-900">Pending Reviews (48h+)</h4>
                <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                  {pendingCount || 0}
                </Badge>
              </div>
              <p className="text-sm text-orange-800 mb-3">
                {pendingCount && pendingCount > 0 
                  ? `${pendingCount} submission${pendingCount === 1 ? '' : 's'} waiting for review longer than 48 hours.`
                  : "All recent submissions have been reviewed!"
                }
              </p>
              <Button 
                className="w-full bg-orange-600 hover:bg-orange-700"
                onClick={() => onTabChange('proof-submissions')}
              >
                Start Reviewing
              </Button>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h4 className="font-medium text-blue-900 mb-2">Total Pending</h4>
              <p className="text-2xl font-bold text-blue-900 mb-2">{stats?.pendingReviews || 0}</p>
              <p className="text-sm text-blue-800">
                Total submissions awaiting review
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboardContent;