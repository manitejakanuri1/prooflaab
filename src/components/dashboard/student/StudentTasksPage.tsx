import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAllStudentTasks } from "@/hooks/useAllStudentTasks";
import { format } from "date-fns";
import { 
  Calendar, 
  Award, 
  Play, 
  Upload, 
  Search, 
  Filter, 
  Eye, 
  CheckCircle, 
  FileText,
  MoreVertical,
  X,
  Target
} from "lucide-react";
import UploadProofModal from "@/components/dashboard/UploadProofModal";
import TaskDetailsDialog from "./TaskDetailsDialog";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const StudentTasksPage = () => {
  const { tasks, loading, startTask } = useAllStudentTasks();
  const navigate = useNavigate();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskForDetails, setSelectedTaskForDetails] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Due Date (ASC)");

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

    // Apply source filter
    if (sourceFilter !== "All") {
      filtered = filtered.filter(task => {
        const taskSource = task.source?.toLowerCase() || '';
        return taskSource === sourceFilter.toLowerCase();
      });
    }

    // Apply sorting
    const sortedTasks = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "Status Priority":
          // Group by status: In Progress > Applied > Under Review > Completed
          const statusPriority = { "In Progress": 1, "Applied": 2, "Under Review": 3, "Completed": 4 };
          const priorityDiff = (statusPriority[a.status] || 5) - (statusPriority[b.status] || 5);
          if (priorityDiff !== 0) return priorityDiff;
          // Secondary sort by creation date (newest first)
          return new Date(b.deadline).getTime() - new Date(a.deadline).getTime();
          
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
            return new Date(b.deadline).getTime() - new Date(a.deadline).getTime();
          
        default:
          return 0;
      }
    });

    return sortedTasks;
  }, [tasks, searchQuery, statusFilter, sourceFilter, sortBy]);

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

  const getSourceBadgeColor = (source: string) => {
    const normalizedSource = source?.toLowerCase() || '';
    if (normalizedSource === 'college') return 'bg-blue-100 text-blue-700 border-blue-200';
    if (normalizedSource === 'admin') return 'bg-gray-100 text-gray-700 border-gray-200';
    if (normalizedSource === 'startup') return 'bg-green-100 text-green-700 border-green-200';
    return 'bg-muted text-muted-foreground border-border';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Applied':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'In Progress':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Completed':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'Under Review':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Overdue':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const formatDueDate = (deadline: string) => {
    if (!deadline) return "Not Set";
    try {
      return format(new Date(deadline), "MMM dd, yyyy");
    } catch {
      return deadline;
    }
  };

  const handleStartTask = async (taskId: string) => {
    try {
      await startTask(taskId);
      toast.success("Task started successfully!");
    } catch (error) {
      console.error('Error starting task:', error);
      toast.error("Failed to start task");
    }
  };

  const handleWithdraw = (taskId: string) => {
    toast.info("Withdraw functionality coming soon");
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
          <div className="flex flex-col sm:flex-row gap-3 p-4 bg-muted/30 rounded-lg border">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Status</SelectItem>
                  <SelectItem value="Applied">Applied</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Under Review">Under Review</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sources</SelectItem>
                  <SelectItem value="College">College</SelectItem>
                  <SelectItem value="Admin">Admin</SelectItem>
                  <SelectItem value="Startup">Startup</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Due Date (ASC)">Due Date (Soonest)</SelectItem>
                  <SelectItem value="Due Date (DESC)">Due Date (Latest)</SelectItem>
                  <SelectItem value="XP (DESC)">XP (High to Low)</SelectItem>
                  <SelectItem value="XP (ASC)">XP (Low to High)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredAndSortedTasks.length === 0 ? (
            <div className="text-center py-16">
              <Target className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {tasks.length === 0 ? "No tasks assigned yet" : "No tasks match your filters"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {tasks.length === 0 
                  ? "Check back soon for new opportunities."
                  : "Try adjusting your search or filter criteria."
                }
              </p>
              {tasks.length === 0 && (
                <Button
                  onClick={() => navigate("/student/dashboard")}
                  className="bg-primary hover:bg-primary/90"
                >
                  Explore Available Tasks
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAndSortedTasks.map((task) => (
                <Card key={task.id} className="hover:shadow-md transition-shadow border-l-4 border-l-primary/20">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Task Info */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start gap-3 flex-wrap">
                          <h3 className="font-semibold text-base text-foreground line-clamp-1 flex-1 min-w-0">
                            {task.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge 
                              variant="outline" 
                              className={getSourceBadgeColor(task.source || '')}
                            >
                              {task.source || 'Unknown'}
                            </Badge>
                            <Badge 
                              variant="outline" 
                              className={getStatusColor(task.status)}
                            >
                              {task.status}
                            </Badge>
                          </div>
                        </div>

                        {task.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {task.description}
                          </p>
                        )}

                        <div className="flex items-center gap-4 flex-wrap text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            <span>{formatDueDate(task.deadline)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-orange-600 font-medium">
                            <Award className="h-4 w-4" />
                            <span>{task.xp_reward || 0} XP</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {task.status === 'Applied' && task.can_start && (
                          <Button
                            size="sm"
                            onClick={() => handleStartTask(task.id)}
                            className="bg-primary hover:bg-primary/90"
                          >
                            <Play className="h-4 w-4 mr-1" />
                            Start Task
                          </Button>
                        )}
                        {task.status === 'In Progress' && (
                          <Button
                            size="sm"
                            onClick={() => setSelectedTaskId(task.id)}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Upload className="h-4 w-4 mr-1" />
                            Submit Proof
                          </Button>
                        )}
                        {task.status === 'Completed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 text-green-700 border-green-200"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            View Submission
                          </Button>
                        )}
                        {task.status === 'Under Review' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-purple-50 text-purple-700 border-purple-200"
                            disabled
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Under Review
                          </Button>
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedTaskForDetails(task.id)}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            {task.status === 'In Progress' && (
                              <DropdownMenuItem onClick={() => setSelectedTaskId(task.id)}>
                                <Upload className="h-4 w-4 mr-2" />
                                Submit Proof
                              </DropdownMenuItem>
                            )}
                            {task.status === 'Applied' && (
                              <DropdownMenuItem 
                                onClick={() => handleWithdraw(task.id)}
                                className="text-red-600"
                              >
                                <X className="h-4 w-4 mr-2" />
                                Withdraw
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
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

      {/* Task Details Dialog */}
      <TaskDetailsDialog
        task={filteredAndSortedTasks.find(t => t.id === selectedTaskForDetails) || null}
        isOpen={!!selectedTaskForDetails}
        onClose={() => setSelectedTaskForDetails(null)}
        onStartTask={handleStartTask}
        onUploadProof={(taskId) => {
          setSelectedTaskForDetails(null);
          setSelectedTaskId(taskId);
        }}
      />
    </div>
  );
};

export default StudentTasksPage;