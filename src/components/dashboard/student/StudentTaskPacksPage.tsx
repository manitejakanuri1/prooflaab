import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Package, BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStudentAllPacksProgress } from "@/hooks/useStudentPackProgress";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

const difficultyColors: Record<Difficulty, string> = {
  Beginner: "bg-green-500/10 text-green-600 border-green-500/20",
  Intermediate: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  Advanced: "bg-red-500/10 text-red-600 border-red-500/20",
};

const StudentTaskPacksPage = () => {
  const navigate = useNavigate();
  const { data: packs, isLoading } = useStudentAllPacksProgress();

  const handleStartPack = (packId: string) => {
    navigate(`/student/task-packs/${packId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!packs || packs.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Task Packs</h2>
          <p className="text-muted-foreground">
            Curated collections of tasks to build your skills step by step
          </p>
        </div>
        <Card>
          <CardContent className="text-center py-16">
            <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">No Task Packs Available</h3>
            <p className="text-muted-foreground">Check back later for new task packs.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Task Packs</h2>
        <p className="text-muted-foreground">
          Curated collections of tasks to build your skills step by step
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => {
          const difficulty = pack.difficulty as Difficulty;
          const hasStarted = pack.progress > 0;

          return (
            <Card 
              key={pack.id} 
              className="flex flex-col hover:shadow-md transition-shadow duration-200"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <Badge 
                      variant="outline" 
                      className={difficultyColors[difficulty] || difficultyColors.Beginner}
                    >
                      {pack.difficulty}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <BookOpen className="h-4 w-4" />
                    <span>{pack.taskCount} tasks</span>
                  </div>
                </div>
                <CardTitle className="text-lg mt-3">{pack.name}</CardTitle>
                <CardDescription className="line-clamp-2">
                  {pack.description}
                </CardDescription>
              </CardHeader>
              
              <CardContent className="flex-1 flex flex-col justify-end pt-0">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{pack.progress}%</span>
                    </div>
                    <Progress value={pack.progress} className="h-2" />
                  </div>
                  
                  <Button 
                    className="w-full group"
                    onClick={() => handleStartPack(pack.id)}
                  >
                    {hasStarted ? "Continue Pack" : "Start Pack"}
                    <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default StudentTaskPacksPage;
