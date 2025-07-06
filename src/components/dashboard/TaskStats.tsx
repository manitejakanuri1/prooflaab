
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
    <Card className="bg-white/60 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900">Task Progress</CardTitle>
        <div className="text-3xl font-bold text-gray-900">{completionPercentage}%</div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Overview */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tasks</span>
            <span className="font-medium text-gray-900">{completedTasks}/{totalTasks}</span>
          </div>
          <Progress value={completionPercentage} className="h-2" />
          <div className="text-xs text-gray-600">Status: Progress</div>
        </div>

        {/* Status Breakdown */}
        <div className="flex justify-between items-center">
          <div className="flex space-x-4">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-xs text-gray-600">{statusCounts.completed}% Completed</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
              <span className="text-xs text-gray-600">{Math.round((statusCounts.inProgress / totalTasks) * 100)}% In Progress</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <span className="text-xs text-gray-600">{Math.round((statusCounts.pending / totalTasks) * 100)}% Pending</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
