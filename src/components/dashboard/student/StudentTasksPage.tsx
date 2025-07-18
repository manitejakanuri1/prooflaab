import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAssignedTasks } from "@/hooks/useAssignedTasks";
import { format } from "date-fns";
import { Clock, Award, Play, Upload } from "lucide-react";
import UploadProofModal from "@/components/dashboard/UploadProofModal";

const StudentTasksPage = () => {
  const { tasks, loading, startTask } = useAssignedTasks();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800';
      case 'Completed':
        return 'bg-green-100 text-green-800';
      case 'Overdue':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleStartTask = async (taskId: string) => {
    try {
      await startTask(taskId);
    } catch (error) {
      console.error('Error starting task:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">My Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks assigned yet</h3>
              <p className="text-gray-500">Check back later for new assignments from your instructors.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task Title</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>XP Reward</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium text-gray-900">{task.title}</div>
                          {task.description && (
                            <div className="text-sm text-gray-500 mt-1">
                              {task.description.substring(0, 100)}
                              {task.description.length > 100 ? '...' : ''}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {format(new Date(task.deadline), "MMM dd, yyyy")}
                        </div>
                        <div className="text-xs text-gray-500">
                          {format(new Date(task.deadline), "h:mm a")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(task.status)}>
                          {task.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <Award className="h-4 w-4 text-orange-500" />
                          <span className="font-medium">{task.xp_reward || 0}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end space-x-2">
                          {task.status === 'Pending' && (
                            <Button
                              size="sm"
                              onClick={() => handleStartTask(task.id)}
                              className="bg-orange-600 hover:bg-orange-700"
                            >
                              <Play className="h-4 w-4 mr-1" />
                              Start
                            </Button>
                          )}
                          {task.status === 'In Progress' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedTaskId(task.id)}
                              className="border-orange-300 text-orange-700 hover:bg-orange-50"
                            >
                              <Upload className="h-4 w-4 mr-1" />
                              Upload Proof
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Proof Modal */}
      {selectedTaskId && (
        <UploadProofModal
          taskId={selectedTaskId}
          taskTitle={tasks.find(t => t.id === selectedTaskId)?.title || "Task"}
          isOpen={!!selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
};

export default StudentTasksPage;