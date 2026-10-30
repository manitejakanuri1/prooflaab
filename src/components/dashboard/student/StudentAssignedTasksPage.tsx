import { useState, useMemo, useEffect, useRef } from "react";
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
import SandboxTaskPanel, { TASK_SCREEN_CLASS } from "./SandboxTaskPanel";
import WrittenTaskPanel from "./WrittenTaskPanel";
import TaskVoicePanel from "./TaskVoicePanel";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Code2, PenLine } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const StudentAssignedTasksPage = () => {
  const navigate = useNavigate();
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
  // The recorder beside the answer on the full-screen task page.
  const voiceFor = (taskId: string) => profile?.id
    ? (unlocked: boolean, onDone?: () => void) => (
        <TaskVoicePanel unlocked={unlocked} studentId={profile.id} taskId={taskId}
          title={allTasks.find((x) => x.id === taskId)?.title ?? "this task"} onSaved={refetchTasks} onDone={onDone} />
      )
    : undefined;
  const [selectedTaskForDetails, setSelectedTaskForDetails] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Due Date (ASC)");

  // Filter only assigned tasks (from admin/college, not student-created or startup applications)
  const assignedTasks = useMemo(() => {
    return allTasks.filter(task => {
      const source = task.source?.toLowerCase() || '';
      // Everything the student has to do, except company tasks they applied
      // to (those have their own flow) and the Daily Lot, which the Floor card
      // already shows: the same Lot twice read as two different tasks.
      return source !== 'company' && source !== 'daily lot';
    });
  }, [allTasks]);


  const firstOrder = useRef(new Map<string, number>());
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

    // MF-093: remember the order each task was first shown in. Starting a task re-fetches the list and the
    // rows can come back in a different order; ties are broken by that first order, so nothing jumps.
    const seen = firstOrder.current;
    for (const t of assignedTasks) if (!seen.has(t.id)) seen.set(t.id, seen.size);
    const sortedTasks = [...filtered].sort((a, b) => (byChoice(a, b) || seen.get(a.id)! - seen.get(b.id)!));
    function byChoice(a: typeof filtered[number], b: typeof filtered[number]) {
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
    }

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
          <h2 className="text-2xl font-bold mb-2">Your Tasks</h2>
          <p className="text-muted-foreground">Every task you have, and where it came from. Today's Daily Lot is in the card above.</p>
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

  // Where each task came from, in the student's words (the hook's labels are short codes).
  const SOURCE_LABEL: Record<string, string> = {
    "From your test": "From your onboarding test",
    "Track proof": "From a track lesson",
    "College": "From your college",
    "Admin": "From ProofLab admin",
    "Company": "From a company",
  };
  const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? (source || "Task");
  const sourceCounts = Object.entries(
    assignedTasks.reduce<Record<string, number>>((acc, t) => {
      const k = sourceLabel(t.source || "");
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  );

  // Owner, 22 Oct 2026: once every roadmap task from the onboarding test is done inside ProofLab,
  // the next step is to build one on their own - text only, no outside links.
  const roadmapTasks = assignedTasks.filter((t) => t.source === "From your test");
  const roadmapDone = roadmapTasks.length > 0 && roadmapTasks.every((t) => t.status === "Completed");
  const bossProject = roadmapTasks[0]?.title?.replace(/^Roadmap:\s*/, "");

  const getSourceBadgeColor = (source: string) => {
    const normalizedSource = source?.toLowerCase() || '';
    if (normalizedSource === 'college') return 'bg-primary/10 text-primary border-primary/40';
    if (normalizedSource === 'admin') return 'bg-muted text-muted-foreground border-border';
    return 'bg-muted text-muted-foreground border-border';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Applied':
        return 'bg-compete/10 text-compete border-compete/40';
      case 'In Progress':
        return 'bg-primary/10 text-primary border-primary/40';
      case 'Completed':
        return 'bg-verified/10 text-verified border-verified/40';
      case 'Under Review':
        return 'bg-compete/10 text-compete border-compete/40';
      case 'Overdue':
        return 'bg-alert/10 text-alert border-alert/40';
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
      // Open the task straight away instead of leaving the student to find a new button in the list.
      const t = allTasks.find((x) => x.id === taskId);
      if (t?.sandbox_config_id) setCodingTaskId(taskId); else setWritingTaskId(taskId);
    } catch (error) {
      console.error('Error starting task:', error);
      toast.error("Failed to start task");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Your Tasks</h2>
        <p className="text-muted-foreground">Every task you have, and where it came from. Today's Daily Lot is in the card above.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            All your tasks
            <Badge variant="outline" className="ml-auto">
              {filteredAndSortedTasks.length} tasks
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {roadmapDone && (
            <div className="rounded-lg border border-compete/60 bg-compete/10 p-4" data-testid="roadmap-boss">
              <p className="font-semibold">🏆 You have almost reached Boss level!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You finished all {roadmapTasks.length} roadmap tasks inside ProofLab. One last step to become a real Boss:
                build {bossProject ? <>a small {bossProject} project</> : "one project from your roadmap"} on your own, start to finish.
              </p>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
                <li>Write and test it first in ProofLab's code editor until every part works.</li>
                <li>Install the same language on your laptop and make a new project folder.</li>
                <li>Copy your code in, run it, and fix anything that behaves differently.</li>
                <li>Add one new feature on your own, without help.</li>
                <li>Put the project on your resume and LinkedIn, and say what you built.</li>
              </ol>
            </div>
          )}
          {sourceCounts.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="task-sources">
              {sourceCounts.map(([label, n]) => (
                <Badge key={label} variant="outline" className="font-normal">{label}: {n}</Badge>
              ))}
            </div>
          )}
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
                  ? "Tasks from your onboarding test, your college or ProofLab will appear here."
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
                              {sourceLabel(task.source || '')}
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
                          <div className="flex items-center gap-1.5 text-compete font-medium">
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
                              >
                                <Code2 className="h-4 w-4 mr-1" />
                                Solve in editor
                              </Button>
                            ) : task.rubric_config_id ? (
                              <Button
                                size="sm"
                                onClick={() => setWritingTaskId(task.id)}
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
                            onClick={() => navigate(`/student/dashboard?tab=log&view=entries&task=${encodeURIComponent(task.id)}`)}
                            className="bg-verified/10 text-verified border-verified/40"
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
                              className="bg-compete/10 text-compete border-compete/40"
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
        <Dialog open={!!codingTaskId} onOpenChange={(open) => { if (!open) { setCodingTaskId(null); refetchTasks(); } }}>
          <DialogContent className={TASK_SCREEN_CLASS}>
            <SandboxTaskPanel
              taskId={codingTaskId}
              voice={voiceFor(codingTaskId)}
              onCompleted={() => { explainAfter(codingTaskId); setCodingTaskId(null); refetchTasks(); }}
            />
          </DialogContent>
        </Dialog>
      )}

      {writingTaskId && (
        <Dialog open={!!writingTaskId} onOpenChange={(open) => { if (!open) { setWritingTaskId(null); refetchTasks(); } }}>
          <DialogContent className={TASK_SCREEN_CLASS}>
            <WrittenTaskPanel
              taskId={writingTaskId}
              voice={voiceFor(writingTaskId)}
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
