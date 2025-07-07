
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface Task {
  id: string;
  title: string;
  deadline: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  progress: number;
}

interface TaskStatsProps {
  tasks: Task[];
}

export default function TaskStats({ tasks }: TaskStatsProps) {
  const completedTasks = tasks.filter(task => task.status === 'Completed').length;
  const totalTasks = tasks.length;
  const completionPercentage = Math.round((completedTasks / totalTasks) * 100);

  const statusCounts = {
    completed: completedTasks,
    inProgress: tasks.filter(task => task.status === 'In Progress').length,
    pending: tasks.filter(task => task.status === 'Pending').length
  };

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900">Task Stats</CardTitle>
        <div className="text-3xl font-bold text-gray-900">{completionPercentage}%</div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Overview */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tasks Completed</span>
            <span className="font-medium text-gray-900">{completedTasks}/{totalTasks}</span>
          </div>
          <Progress value={completionPercentage} className="h-2" />
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="text-center p-3 bg-green-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-xs font-medium text-green-700">Completed</span>
            </div>
            <div className="text-lg font-bold text-green-600">{statusCounts.completed}</div>
          </div>
          <div className="text-center p-3 bg-yellow-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
              <span className="text-xs font-medium text-yellow-700">In Progress</span>
            </div>
            <div className="text-lg font-bold text-yellow-600">{statusCounts.inProgress}</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <span className="text-xs font-medium text-gray-700">Pending</span>
            </div>
            <div className="text-lg font-bold text-gray-600">{statusCounts.pending}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
