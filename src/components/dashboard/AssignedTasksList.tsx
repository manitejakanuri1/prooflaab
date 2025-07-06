
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

export default function AssignedTasksList({ tasks }: AssignedTasksListProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Completed': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'In Progress': return <Clock className="h-4 w-4 text-yellow-600" />;
      default: return <AlertCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'In Progress': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className="bg-gray-900 text-white border-0 shadow-lg rounded-3xl h-fit">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-white">Assigned Tasks</CardTitle>
        <div className="text-2xl font-bold text-white">{tasks.length}/8</div>
      </CardHeader>
      <CardContent className="space-y-4">
        {tasks.slice(0, 3).map((task) => (
          <div key={task.id} className="bg-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                  {getStatusIcon(task.status)}
                </div>
                <div>
                  <h4 className="font-medium text-white text-sm">{task.title}</h4>
                  <p className="text-xs text-gray-300">{task.deadline}</p>
                </div>
              </div>
              
              {task.status === 'Completed' ? (
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-white" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-gray-600"></div>
              )}
            </div>
            
            {task.status !== 'Completed' && (
              <Button 
                size="sm" 
                className="w-full bg-white/20 hover:bg-white/30 text-white border-0"
              >
                <Upload className="h-3 w-3 mr-2" />
                Upload Proof
              </Button>
            )}
          </div>
        ))}
        
        {/* Show more tasks indicator */}
        {tasks.length > 3 && (
          <div className="text-center pt-2">
            <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white">
              View all {tasks.length} tasks
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
