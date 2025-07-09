
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useTaskStats } from "@/hooks/useTaskStats";

export default function TaskStats() {
  const { taskStats, loading, error } = useTaskStats();

  if (loading) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-gray-900 text-center">Task Stats</CardTitle>
          <div className="text-3xl font-bold text-gray-900">Loading...</div>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-gray-900 text-center">Task Stats</CardTitle>
          <div className="text-sm text-red-600">Error: {error}</div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 text-center">Task Stats</CardTitle>
        <div className="text-3xl font-bold text-gray-900">{taskStats.completionPercentage}%</div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Overview */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tasks Completed</span>
            <span className="font-medium text-gray-900">{taskStats.completedTasks}/{taskStats.totalTasks}</span>
          </div>
          <Progress value={taskStats.completionPercentage} className="h-2" />
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="text-center p-3 bg-green-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-xs font-medium text-green-700">Completed</span>
            </div>
            <div className="text-lg font-bold text-green-600">{taskStats.completedTasks}</div>
          </div>
          <div className="text-center p-3 bg-yellow-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
              <span className="text-xs font-medium text-yellow-700">In Progress</span>
            </div>
            <div className="text-lg font-bold text-yellow-600">{taskStats.inProgressTasks}</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <span className="text-xs font-medium text-gray-700">Pending</span>
            </div>
            <div className="text-lg font-bold text-gray-600">{taskStats.pendingTasks}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
