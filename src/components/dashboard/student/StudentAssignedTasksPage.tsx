import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAllStudentTasks } from "@/hooks/useAllStudentTasks";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { format } from "date-fns";
import {
  Calendar,
  Award,
  Play, Search,
  Eye,
  CheckCircle,
  Mic,
  ClipboardList,
  MoreVertical,
  Target
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import VoiceExplainModal from "./VoiceExplainModal";
import { explainIfSubmitted } from "@/lib/explainGate";
import TaskDetailsDialog from "./TaskDetailsDialog";
import SandboxTaskPanel from "./SandboxTaskPanel";
import WrittenTaskPanel from "./WrittenTaskPanel";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Code2, PenLine } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const StudentAssignedTasksPage = () => {
  const { tasks: allTasks, loading, startTask, refetch: refetchTasks } = useAllStudentTasks();
  const [codingTaskId, setCodingTaskId] = useState<string | null>(null);
  const [writingTaskId, setWritingTaskId] = useState<string | null>(null);
  const [explainTask, setExplainTask] = useState<{ id: string; title: string } | null>(null);
  // After a pass, the spoken explanation is the next step, not an optional extra.
  const explainAfter = (taskId: string) => {
    const t = allTasks.find((x) => x.id === taskId);
    setExplainTask({ id: taskId, title: t?.title ?? "this task" });
  };
  const { profile } = useStudentProfile();
  const [selectedTaskForDetails, setSelectedTaskForDetails] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Due Date (ASC)");

  // Filter only assigned tasks (from admin/college, not student-created or startup applications)
  const assignedTasks = useMemo(() => {
    return allTasks.filter(task => {
      const source = task.source?.toLowerCase() || '';
      // Everything the student has to do, except company tasks they applied
      // to (those have their own flow). Roadmap and Track tasks used to get in
      // here only because they were mislabelled "Admin".
      return source !== 'company';
    });
  }, [allTasks]);


  // Enhanced sorting and filtering logic
  const filteredAndSortedTasks = useMemo(() => {
    let filtered = assignedTasks;

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
        case "Due Date (ASC)": {
          const aDate = a.deadline ? new Date(a.deadline) : new Date("9999-12-31");
          const bDate = b.deadline ? new Date(b.deadline) : new Date("9999-12-31");
          return aDate.getTime() - bDate.getTime();
        }

        case "Due Date (DESC)": {
          const aDateDesc = a.deadline ? new Date(a.deadline) : new Date("1970-01-01");
          const bDateDesc = b.deadline ? new Date(b.deadline) : new Date("1970-01-01");
          return bDateDesc.getTime() - aDateDesc.getTime();
        }
          
        case "XP (ASC)":
          return (a.xp_reward || 0) - (b.xp_reward || 0);
          
        case "XP (DESC)":
          return (b.xp_reward || 0) - (a.xp_reward || 0);
          
        default:
          return 0;
      }
    });

    return sortedTasks;
  }, [assignedTasks, searchQuery, statusFilter, sortBy]);

  // "Start" on the Roadmap sends the student here with ?open=<task id>: start that task and open
  // its writing (or coding) box straight away, instead of leaving them in the list to find it.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get("open");
    if (!id || loading) return;
    setParams({}, { replace: true });              // only once
    const task = allTasks.find((t) => t.id === id);
    if (!task || (task.status !== "Applied" && task.status !== "In Progress")) return;
    void (async () => {
      try {
        if (task.can_start) { await startTask(id); toast.success("Task started successfully!"); }
      } catch (error) {
        console.error("Error starting task:", error);
        toast.error("Failed to start task");
        return;
      }
      if (task.sandbox_config_id) setCodingTaskId(id); else setWritingTaskId(id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loading, allTasks]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Assigned Tasks</h2>
          <p className="text-muted-foreground">Tasks assigned to you by colleges and admins</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-muted rounded"></div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getSourceBadgeColor = (source: string) => {
    const normalizedSource = source?.toLowerCase() || '';
    if (normalizedSource === 'college') return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400';
    if (normalizedSource === 'admin') return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400';
    return 'bg-muted text-muted-foreground border-border';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Applied':
        return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400';
      case 'In Progress':
        return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400';
      case 'Completed':
        return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400';
      case 'Under Review':
        return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400';
      case 'Overdue':
        return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400';
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Assigned Tasks</h2>
        <p className="text-muted-foreground">Tasks assigned to you by colleges and admins</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Your Assignments
            <Badge variant="outline" className="ml-auto">
              {filteredAndSortedTasks.length} tasks
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-3 p-3 sm:p-4 bg-muted/30 rounded-lg border">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="All">All Status</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Under Review">Under Review</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
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
                {assignedTasks.length === 0 ? "No assigned tasks yet" : "No tasks match your filters"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {assignedTasks.length === 0 
                  ? "Tasks assigned by your college or admin will appear here."
                  : "Try adjusting your search or filter criteria."
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAndSortedTasks.map((task) => (
                <Card key={task.id} className="hover:shadow-md transition-shadow border-l-4 border-l-primary/20">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                      {/* Left: Task Info */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                          <h3 className="font-semibold text-sm sm:text-base text-foreground line-clamp-2 flex-1 min-w-0">
                            {task.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-wrap">
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
                              {task.status === 'Applied' ? 'Not started' : task.status}
                            </Badge>
                          </div>
                        </div>

                        {task.description && (
                          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
                            {task.description}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span>{formatDueDate(task.deadline)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-orange-600 font-medium">
                            <Award className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span>{task.xp_reward || 0} XP</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0">
                        {task.status === 'Applied' && task.can_start && (
                          <Button
                            size="sm"
                            onClick={() => handleStartTask(task.id)}
                            className="bg-orange-600 hover:bg-orange-700 text-white"
                          >
                            <Play className="h-4 w-4 mr-1" />
                            Start Task
                          </Button>
                        )}
                        {task.status === 'In Progress' && (
                          <>
                            {task.sandbox_config_id ? (
                              <Button
                                size="sm"
                                onClick={() => setCodingTaskId(task.id)}
                                className="bg-orange-600 hover:bg-orange-700 text-white"
                              >
                                <Code2 className="h-4 w-4 mr-1" />
                                Solve in editor
                              </Button>
                            ) : task.rubric_config_id ? (
                              <Button
                                size="sm"
                                onClick={() => setWritingTaskId(task.id)}
                                className="bg-orange-600 hover:bg-orange-700 text-white"
                              >
                                <PenLine className="h-4 w-4 mr-1" />
                                Write my answer
                              </Button>
                            ) : (
                              // No upload anywhere: a task without its own
                              // checker is answered in writing (the server gives
                              // every task one, so this is only a safety net).
                              <Button
                                size="sm"
                                onClick={() => setWritingTaskId(task.id)}
                                className="bg-orange-600 hover:bg-orange-700 text-white"
                              >
                                <PenLine className="h-4 w-4 mr-1" />
                                Write my answer
                              </Button>
                            )}
                            {/* The second of the two actions the design deck
                                allows on this screen. Explaining the work out
                                loud is the part that cannot be pasted. */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void explainIfSubmitted(task.id, () => setExplainTask({ id: task.id, title: task.title }))}
                            >
                              <Mic className="h-4 w-4 mr-1" />
                              Explain 60s
                            </Button>
                          </>
                        )}
                        {task.status === 'Completed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            View Submission
                          </Button>
                        )}
                        {task.status === 'Under Review' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400"
                              disabled
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Under Review
                            </Button>

                          </>
                        )}
                        
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-background border border-border">
                            <DropdownMenuItem onClick={() => setSelectedTaskForDetails(task.id)}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
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

      {/* stage69/70: coding and written tasks skip the proof/quiz flow
          entirely — they are graded automatically the moment they submit. */}
      {codingTaskId && (
        <Dialog open={!!codingTaskId} onOpenChange={(open) => !open && setCodingTaskId(null)}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <SandboxTaskPanel
              taskId={codingTaskId}
              onCompleted={() => { explainAfter(codingTaskId); setCodingTaskId(null); refetchTasks(); }}
            />
          </DialogContent>
        </Dialog>
      )}

      {writingTaskId && (
        <Dialog open={!!writingTaskId} onOpenChange={(open) => !open && setWritingTaskId(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <WrittenTaskPanel
              taskId={writingTaskId}
              onCompleted={() => { explainAfter(writingTaskId); setWritingTaskId(null); refetchTasks(); }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* The 60-second Explain. Sits beside Submit as the second of the two
          actions the design deck allows on this screen. */}
      {explainTask && profile?.id && (
        <VoiceExplainModal
          open={true}
          onOpenChange={(o) => !o && setExplainTask(null)}
          studentId={profile.id}
          taskId={explainTask.id}
          prompt={`In your own words: how did you approach "${explainTask.title}"?`}
        />
      )}


      {/* Task Details Dialog */}
      {selectedTaskForDetails && (
        <TaskDetailsDialog
          task={filteredAndSortedTasks.find(t => t.id === selectedTaskForDetails)}
          isOpen={!!selectedTaskForDetails}
          onClose={() => setSelectedTaskForDetails(null)}
        />
      )}
    </div>
  );
};

export default StudentAssignedTasksPage;
