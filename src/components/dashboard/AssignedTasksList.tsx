
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Clock, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useAssignedTasks } from "@/hooks/useAssignedTasks";
import { useToast } from "@/hooks/use-toast";
import UploadProofModal from "./UploadProofModal";
import { useState } from "react";

export default function AssignedTasksList() {
  const { tasks, loading, error, startTask, refetch } = useAssignedTasks();
  const { toast } = useToast();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<{ id: string; title: string } | null>(null);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'Under Review':
        return <Upload className="h-4 w-4 text-blue-600" />;
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
      case 'Under Review':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'In Progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleUploadProof = (taskId: string, taskTitle: string) => {
    setSelectedTask({ id: taskId, title: taskTitle });
    setUploadModalOpen(true);
  };

  const handleUploadSuccess = () => {
    refetch();
  };

  const handleStartTask = async (taskId: string, taskTitle: string) => {
    try {
      await startTask(taskId);
      toast({
        title: "Task Started",
        description: `You have started working on "${taskTitle}". Good luck!`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start task. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-fit max-h-[550px] flex flex-col px-0">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-gray-900 text-center">Assigned Tasks</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-fit max-h-[550px] flex flex-col px-0">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-gray-900 text-center">Assigned Tasks</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-red-600 text-sm">Error loading tasks: {error}</p>
        </CardContent>
      </Card>
    );
  }

  const completedTasks = tasks.filter(task => 
    task.status === 'Completed' || task.proof_submitted
  ).length;
  const totalTasks = tasks.length;

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-fit max-h-[550px] flex flex-col px-0">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 text-center">Assigned Tasks</CardTitle>
        <div className="text-2xl font-bold text-center">{completedTasks}/{totalTasks}</div>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 overflow-y-auto px-0">
        {tasks.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">🎉 You have no pending tasks. Enjoy your day!</p>
          </div>
        ) : (
          <>
            {tasks.slice(0, 3).map(task => (
              <div key={task.id} className="bg-gray-50/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm">
                      {getStatusIcon(task.status)}
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 text-sm">{task.title}</h4>
                      <div className="flex items-center space-x-2 text-xs text-gray-600">
                        {!task.proof_submitted && <span>{task.deadline}</span>}
                        {task.duration_days && (
                          <Badge variant="outline" className="text-xs">
                            {task.duration_days} days
                          </Badge>
                        )}
                      </div>
                      {task.upload_deadline && task.started_at && !task.proof_submitted && (
                        <p className="text-xs text-red-600 mt-1 font-medium">Upload by: {task.upload_deadline}</p>
                      )}
                    </div>
                  </div>
                  
                  <Badge className={`${getStatusColor(task.status)} text-xs font-medium border`}>
                    {task.status}
                  </Badge>
                </div>
                
                <div className="flex space-x-2">
                  {task.can_start && (
                    <Button 
                      size="sm" 
                      className="flex-1 bg-gray-900 hover:bg-gray-800 text-white rounded-xl shadow-sm"
                      onClick={() => handleStartTask(task.id, task.title)}
                    >
                      Start Task
                    </Button>
                  )}
                  {task.status === 'In Progress' && !task.proof_submitted && (
                    <Button 
                      size="sm" 
                      className="flex-1 bg-gray-900 hover:bg-gray-800 text-white rounded-xl shadow-sm"
                      onClick={() => handleUploadProof(task.id, task.title)}
                    >
                      <Upload className="h-3 w-3 mr-2" />
                      Upload Proof
                    </Button>
                  )}
                  {task.status === 'Under Review' && (
                    <div className="flex-1 text-center text-sm text-blue-600 font-medium py-2">
                      Proof submitted - Under review
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {/* Show more tasks indicator */}
            {tasks.length > 3 && (
              <div className="text-center pt-2">
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900 hover:bg-white/60 rounded-xl">
                  View all {tasks.length} tasks
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      {selectedTask && (
        <UploadProofModal
          isOpen={uploadModalOpen}
          onClose={() => {
            setUploadModalOpen(false);
            setSelectedTask(null);
          }}
          taskId={selectedTask.id}
          taskTitle={selectedTask.title}
          onSuccess={handleUploadSuccess}
        />
      )}
    </Card>
  );
}
