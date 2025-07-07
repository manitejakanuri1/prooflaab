import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Clock, CheckCircle, AlertCircle } from "lucide-react";

interface Task {
  id: string;
  title: string;
  deadline: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  progress: number;
}

interface AssignedTasksListProps {
  tasks: Task[];
}

export default function AssignedTasksList({
  tasks
}: AssignedTasksListProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'In Progress':
        return <Clock className="h-4 w-4 text-yellow-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'In Progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full flex flex-col px-0">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 text-center">Assigned Tasks</CardTitle>
        <div className="text-2xl font-bold text-gray-900">{tasks.length}/8</div>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 overflow-y-auto px-0">
        {tasks.slice(0, 3).map(task => <div key={task.id} className="bg-gray-50/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm">
                  {getStatusIcon(task.status)}
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 text-sm">{task.title}</h4>
                  <p className="text-xs text-gray-600">{task.deadline}</p>
                </div>
              </div>
              
              <Badge className={`${getStatusColor(task.status)} text-xs font-medium border`}>
                {task.status}
              </Badge>
            </div>
            
            {task.status !== 'Completed' && <Button size="sm" className="w-full bg-gray-900 hover:bg-gray-800 text-white rounded-xl shadow-sm">
                <Upload className="h-3 w-3 mr-2" />
                Upload Proof
              </Button>}
          </div>)}
        
        {/* Show more tasks indicator */}
        {tasks.length > 3 && <div className="text-center pt-2">
            <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900 hover:bg-white/60 rounded-xl">
              View all {tasks.length} tasks
            </Button>
          </div>}
      </CardContent>
    </Card>;
}
