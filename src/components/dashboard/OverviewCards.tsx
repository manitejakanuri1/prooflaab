
import { Award, CheckCircle, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface OverviewData {
  tasksCompleted: number;
  totalTasks: number;
  xpPoints: number;
  trustScore: number;
}

interface OverviewCardsProps {
  data: OverviewData;
}

export default function OverviewCards({ data }: OverviewCardsProps) {
  const completionPercentage = Math.round((data.tasksCompleted / data.totalTasks) * 100);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Progress Tracker */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100 hover:shadow-xl transition-all duration-300">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-blue-800">🎯 Progress Tracker</CardTitle>
            <CheckCircle className="h-6 w-6 text-blue-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="text-3xl font-bold text-blue-800">
              {completionPercentage}%
            </div>
            <Progress value={completionPercentage} className="h-3 bg-blue-200" />
            <p className="text-sm text-blue-700">
              {data.tasksCompleted} of {data.totalTasks} tasks completed
            </p>
          </div>
        </CardContent>
      </Card>

      {/* XP Points */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-green-100 hover:shadow-xl transition-all duration-300">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-green-800">🧠 XP Points</CardTitle>
            <Award className="h-6 w-6 text-green-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-3xl font-bold text-green-800">{data.xpPoints.toLocaleString()}</div>
            <p className="text-sm text-green-700">Total experience earned</p>
          </div>
        </CardContent>
      </Card>

      {/* Trust Score */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-purple-100 hover:shadow-xl transition-all duration-300">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-purple-800 flex items-center gap-2">
              📈 Trust Score
              <span 
                className="text-xs bg-purple-200 px-2 py-1 rounded-full cursor-help" 
                title="Based on timely submissions, task quality, and plagiarism check"
              >
                ℹ️
              </span>
            </CardTitle>
            <Trophy className="h-6 w-6 text-purple-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="text-3xl font-bold text-purple-800">{data.trustScore}/100</div>
            <Progress value={data.trustScore} className="h-3 bg-purple-200" />
            <p className="text-sm text-purple-700">Excellent performance</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
