
import { Award, User, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface OverviewData {
  tasksCompleted: number;
  xpPoints: number;
  trustScore: number;
}

interface OverviewCardsProps {
  data: OverviewData;
}

export default function OverviewCards({ data }: OverviewCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tasks Completed ✅</CardTitle>
          <Activity className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">{data.tasksCompleted}</div>
          <p className="text-xs text-muted-foreground">This month</p>
        </CardContent>
      </Card>

      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">XP Points 🎯</CardTitle>
          <Award className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{data.xpPoints}</div>
          <p className="text-xs text-muted-foreground">Total earned</p>
        </CardContent>
      </Card>

      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            Trust Score 📈
            <span 
              className="text-xs bg-gray-100 px-2 py-1 rounded-full cursor-help" 
              title="Based on timely submissions, task quality, and plagiarism check"
            >
              ℹ️
            </span>
          </CardTitle>
          <User className="h-4 w-4 text-purple-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-purple-600 mb-2">{data.trustScore}/100</div>
          <Progress value={data.trustScore} className="h-2" />
        </CardContent>
      </Card>
    </div>
  );
}
