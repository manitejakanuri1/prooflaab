import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Package, BookOpen, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface TaskPack {
  id: string;
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  taskCount: number;
  progress: number;
}

const mockTaskPacks: TaskPack[] = [
  {
    id: "pack-1",
    title: "Full Stack Beginner Pack",
    description: "Learn the fundamentals of full stack development with hands-on projects covering HTML, CSS, JavaScript, and basic backend concepts.",
    difficulty: "Beginner",
    taskCount: 8,
    progress: 0,
  },
  {
    id: "pack-2",
    title: "React Essentials",
    description: "Master React fundamentals including components, hooks, state management, and building interactive user interfaces.",
    difficulty: "Intermediate",
    taskCount: 6,
    progress: 0,
  },
  {
    id: "pack-3",
    title: "Backend API Development",
    description: "Build robust REST APIs with Node.js, Express, and database integration. Learn authentication, validation, and best practices.",
    difficulty: "Intermediate",
    taskCount: 7,
    progress: 0,
  },
  {
    id: "pack-4",
    title: "Advanced System Design",
    description: "Tackle complex system design challenges including microservices, caching strategies, and scalable architecture patterns.",
    difficulty: "Advanced",
    taskCount: 5,
    progress: 0,
  },
  {
    id: "pack-5",
    title: "UI/UX Design Fundamentals",
    description: "Learn design principles, create wireframes, and build beautiful interfaces using modern design tools and techniques.",
    difficulty: "Beginner",
    taskCount: 6,
    progress: 0,
  },
  {
    id: "pack-6",
    title: "Data Structures & Algorithms",
    description: "Strengthen your problem-solving skills with essential data structures and algorithmic thinking for technical interviews.",
    difficulty: "Advanced",
    taskCount: 10,
    progress: 0,
  },
];

const difficultyColors: Record<TaskPack["difficulty"], string> = {
  Beginner: "bg-green-500/10 text-green-600 border-green-500/20",
  Intermediate: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  Advanced: "bg-red-500/10 text-red-600 border-red-500/20",
};

const StudentTaskPacksPage = () => {
  const navigate = useNavigate();

  const handleStartPack = (packId: string) => {
    navigate(`/student/task-packs/${packId}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Task Packs</h2>
        <p className="text-muted-foreground">
          Curated collections of tasks to build your skills step by step
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {mockTaskPacks.map((pack) => (
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
                    className={difficultyColors[pack.difficulty]}
                  >
                    {pack.difficulty}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  <span>{pack.taskCount} tasks</span>
                </div>
              </div>
              <CardTitle className="text-lg mt-3">{pack.title}</CardTitle>
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
                  Start Pack
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default StudentTaskPacksPage;
