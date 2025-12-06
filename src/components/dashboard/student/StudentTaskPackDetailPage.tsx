import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Package, Clock, Zap, BookOpen, CheckCircle, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useStudentPackProgress } from "@/hooks/useStudentPackProgress";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

const difficultyColors: Record<Difficulty, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  Intermediate: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  Advanced: "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

// Light pastel colors for task cards - rotating through different hues
const taskCardColors = [
  "border-l-4 border-l-blue-400 bg-blue-50/50 dark:bg-blue-950/20",
  "border-l-4 border-l-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20",
  "border-l-4 border-l-violet-400 bg-violet-50/50 dark:bg-violet-950/20",
  "border-l-4 border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/20",
  "border-l-4 border-l-rose-400 bg-rose-50/50 dark:bg-rose-950/20",
  "border-l-4 border-l-cyan-400 bg-cyan-50/50 dark:bg-cyan-950/20",
  "border-l-4 border-l-orange-400 bg-orange-50/50 dark:bg-orange-950/20",
  "border-l-4 border-l-teal-400 bg-teal-50/50 dark:bg-teal-950/20",
];

const getTaskCardColor = (index: number, isCompleted: boolean) => {
  if (isCompleted) {
    return "border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-950/20";
  }
  return taskCardColors[index % taskCardColors.length];
};

const StudentTaskPackDetailPage = () => {
  const navigate = useNavigate();
  const { packId } = useParams<{ packId: string }>();
  const { data: pack, isLoading } = useStudentPackProgress(packId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => navigate("/student/task-packs")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Task Packs
        </Button>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => navigate("/student/task-packs")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Task Packs
        </Button>
        <Card>
          <CardContent className="text-center py-16">
            <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">Pack Not Found</h3>
            <p className="text-muted-foreground">The task pack you're looking for doesn't exist.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const difficulty = pack.packDifficulty as Difficulty;
  const hasStarted = pack.progressPercent > 0;

  // Find next incomplete task
  const nextIncompleteTask = pack.tasks
    .sort((a, b) => a.taskOrder - b.taskOrder)
    .find((t) => !t.isCompleted);

  return (
    <div className="space-y-6">
      {/* Back Navigation */}
      <Button 
        variant="ghost" 
        onClick={() => navigate("/student/task-packs")}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Task Packs
      </Button>

      {/* Pack Header Section */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl">{pack.packName}</CardTitle>
              </div>
              <p className="text-muted-foreground max-w-2xl">{pack.packDescription}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className={difficultyColors[difficulty] || difficultyColors.Beginner}>
                  <Zap className="h-3 w-3 mr-1" />
                  {pack.packDifficulty}
                </Badge>
                <Badge variant="outline" className="bg-muted/50">
                  <BookOpen className="h-3 w-3 mr-1" />
                  {pack.totalTasks} Tasks
                </Badge>
                {pack.completedTasks > 0 && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {pack.completedTasks} Completed
                  </Badge>
                )}
              </div>
            </div>
            {nextIncompleteTask && (
              <Button 
                className="shrink-0"
                onClick={() => navigate(`/student/task-packs/${packId}/tasks/${nextIncompleteTask.taskId}`)}
              >
                {hasStarted ? "Continue Pack" : "Start Pack"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{pack.progressPercent}%</span>
            </div>
            <Progress value={pack.progressPercent} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Task List Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Tasks in this Pack</h3>
        <div className="space-y-3">
          {pack.tasks
            .sort((a, b) => a.taskOrder - b.taskOrder)
            .map((task, index) => (
              <Card 
                key={task.taskId} 
                className={`hover:shadow-md transition-all duration-200 ${getTaskCardColor(index, task.isCompleted)}`}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                        task.isCompleted 
                          ? "bg-green-500/20 text-green-600" 
                          : "bg-primary/10 text-primary"
                      } font-semibold text-sm`}>
                        {task.isCompleted ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          index + 1
                        )}
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-medium">{task.taskTitle}</h4>
                        <p className="text-sm text-muted-foreground">{task.taskDescription}</p>
                      </div>
                    </div>
                    {task.isCompleted ? (
                      <Badge className="bg-green-500/10 text-green-600 border-green-500/20 shrink-0">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Completed
                      </Badge>
                    ) : (
                      <Button 
                        size="sm"
                        className="shrink-0 bg-orange-500 hover:bg-orange-600 text-white"
                        onClick={() => navigate(`/student/task-packs/${packId}/tasks/${task.taskId}`)}
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        {index === 0 || pack.tasks.slice(0, index).some(t => !t.isCompleted) 
                          ? "Start Task" 
                          : "Continue Task"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
};

export default StudentTaskPackDetailPage;
