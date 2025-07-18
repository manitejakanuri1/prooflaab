import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Clock, Award, Play, Upload, Search, Filter, Eye, CheckCircle, FileText } from "lucide-react";
import UploadProofModal from "@/components/dashboard/UploadProofModal";

const StudentTasksPage = () => {
  const { tasks, loading, startTask } = useAssignedTasks();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Status Priority");

  // Enhanced sorting and filtering logic
  const filteredAndSortedTasks = useMemo(() => {
    let filtered = tasks;

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(task =>
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Apply status filter
    if (statusFilter !== "All") {
      filtered = filtered.filter(task => task.status === statusFilter);
    }

    // Apply sorting
    const sortedTasks = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "Status Priority":
          // Group by status: In Progress > Pending > Under Review > Completed
          const statusPriority = { "In Progress": 1, "Pending": 2, "Under Review": 3, "Completed": 4 };
          const priorityDiff = (statusPriority[a.status] || 5) - (statusPriority[b.status] || 5);
          if (priorityDiff !== 0) return priorityDiff;
          // Secondary sort by creation date (newest first)
          return new Date(b.started_at || b.deadline).getTime() - new Date(a.started_at || a.deadline).getTime();
          
        case "Due Date (ASC)":
          const aDate = a.deadline ? new Date(a.deadline) : new Date("9999-12-31");
          const bDate = b.deadline ? new Date(b.deadline) : new Date("9999-12-31");
          return aDate.getTime() - bDate.getTime();
          
        case "Due Date (DESC)":
          const aDateDesc = a.deadline ? new Date(a.deadline) : new Date("1970-01-01");
          const bDateDesc = b.deadline ? new Date(b.deadline) : new Date("1970-01-01");
          return bDateDesc.getTime() - aDateDesc.getTime();
          
        case "XP (ASC)":
          return (a.xp_reward || 0) - (b.xp_reward || 0);
          
        case "XP (DESC)":
          return (b.xp_reward || 0) - (a.xp_reward || 0);
          
        case "Newest First":
          return new Date(b.started_at || b.deadline).getTime() - new Date(a.started_at || a.deadline).getTime();
          
        default:
          return 0;
      }
    });

    return sortedTasks;
  }, [tasks, searchQuery, statusFilter, sortBy]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'Under Review':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'Overdue':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Pending':
        return <Clock className="h-3 w-3" />;
      case 'In Progress':
        return <Play className="h-3 w-3" />;
      case 'Completed':
        return <CheckCircle className="h-3 w-3" />;
      case 'Under Review':
        return <Eye className="h-3 w-3" />;
      default:
        return <FileText className="h-3 w-3" />;
    }
  };

  const formatDueDate = (deadline: string) => {
    if (!deadline) return "Not Set";
    
    // Since the hook already formats this as relative time, just return it
    return deadline;
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
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            My Tasks
            <Badge variant="outline" className="ml-auto">
              {filteredAndSortedTasks.length} tasks
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-4 p-4 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Status</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Under Review">Under Review</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Status Priority">Status Priority</SelectItem>
                  <SelectItem value="Due Date (ASC)">Due Date (ASC)</SelectItem>
                  <SelectItem value="Due Date (DESC)">Due Date (DESC)</SelectItem>
                  <SelectItem value="XP (ASC)">XP (ASC)</SelectItem>
                  <SelectItem value="XP (DESC)">XP (DESC)</SelectItem>
                  <SelectItem value="Newest First">Newest First</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredAndSortedTasks.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {tasks.length === 0 ? "No tasks assigned yet" : "No tasks match your filters"}
              </h3>
              <p className="text-muted-foreground">
                {tasks.length === 0 
                  ? "Check back later for new assignments from your instructors."
                  : "Try adjusting your search or filter criteria."
                }
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="font-semibold">Task Details</TableHead>
                    <TableHead className="font-semibold">Due Date</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">XP Reward</TableHead>
                    <TableHead className="text-right font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedTasks.map((task, index) => (
                    <TableRow 
                      key={task.id}
                      className={`border-b border-border hover:bg-muted/30 transition-colors ${
                        index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                      }`}
                    >
                      <TableCell className="py-4">
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{task.title}</div>
                          {task.description && (
                            <div className="text-sm text-muted-foreground">
                              {task.description.substring(0, 100)}
                              {task.description.length > 100 ? '...' : ''}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="text-sm text-foreground">
                          {formatDueDate(task.deadline)}
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <Badge 
                          variant="outline" 
                          className={`${getStatusColor(task.status)} flex items-center gap-1 w-fit`}
                        >
                          {getStatusIcon(task.status)}
                          {task.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex items-center gap-1">
                          <Award className="h-4 w-4 text-orange-500" />
                          <span className="font-medium text-foreground">{task.xp_reward || 0}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-4">
                        <div className="flex justify-end gap-2">
                          {task.status === 'Pending' && (
                            <Button
                              size="sm"
                              onClick={() => handleStartTask(task.id)}
                              className="bg-orange-600 hover:bg-orange-700 text-white"
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
                              className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              <Upload className="h-4 w-4 mr-1" />
                              Upload Proof
                            </Button>
                          )}
                          {(task.status === 'Under Review' || task.status === 'Completed') && (
                            <Badge variant="secondary" className="px-3 py-1">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              {task.status === 'Completed' ? 'Verified' : 'Under Review'}
                            </Badge>
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
          taskTitle={filteredAndSortedTasks.find(t => t.id === selectedTaskId)?.title || "Task"}
          isOpen={!!selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
};

export default StudentTasksPage;