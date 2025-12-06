import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Package, Clock, Zap, BookOpen } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

const mockPackDetails: Record<string, {
  id: string;
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  taskCount: number;
  progress: number;
  tasks: Array<{
    id: string;
    title: string;
    summary: string;
    difficulty: "Easy" | "Medium" | "Hard";
  }>;
}> = {
  "1": {
    id: "1",
    title: "Full Stack Beginner Pack",
    description: "Master the fundamentals of full stack development with hands-on projects covering HTML, CSS, JavaScript, and basic backend concepts.",
    difficulty: "Beginner",
    taskCount: 5,
    progress: 0,
    tasks: [
      { id: "t1", title: "Build a Personal Portfolio", summary: "Create a responsive portfolio website using HTML and CSS", difficulty: "Easy" },
      { id: "t2", title: "JavaScript Calculator", summary: "Build an interactive calculator with vanilla JavaScript", difficulty: "Easy" },
      { id: "t3", title: "Todo List Application", summary: "Create a functional todo app with local storage", difficulty: "Medium" },
      { id: "t4", title: "REST API Basics", summary: "Learn to fetch and display data from public APIs", difficulty: "Medium" },
      { id: "t5", title: "Simple Blog Backend", summary: "Build a basic Express.js server with CRUD operations", difficulty: "Medium" },
    ],
  },
  "2": {
    id: "2",
    title: "React Essentials Pack",
    description: "Learn React from the ground up with practical projects that teach components, hooks, state management, and modern React patterns.",
    difficulty: "Intermediate",
    taskCount: 6,
    progress: 0,
    tasks: [
      { id: "t1", title: "React Component Basics", summary: "Build reusable UI components with props and children", difficulty: "Easy" },
      { id: "t2", title: "State Management with Hooks", summary: "Master useState and useEffect for dynamic UIs", difficulty: "Medium" },
      { id: "t3", title: "Form Handling in React", summary: "Create controlled forms with validation", difficulty: "Medium" },
      { id: "t4", title: "React Router Navigation", summary: "Implement multi-page navigation in a SPA", difficulty: "Medium" },
      { id: "t5", title: "Context API Deep Dive", summary: "Share state across components without prop drilling", difficulty: "Hard" },
      { id: "t6", title: "Custom Hooks Workshop", summary: "Create reusable logic with custom hooks", difficulty: "Hard" },
    ],
  },
  "3": {
    id: "3",
    title: "Backend API Mastery",
    description: "Deep dive into backend development with Node.js, Express, databases, authentication, and API best practices.",
    difficulty: "Advanced",
    taskCount: 7,
    progress: 0,
    tasks: [
      { id: "t1", title: "RESTful API Design", summary: "Design and implement a clean REST API structure", difficulty: "Medium" },
      { id: "t2", title: "Database Integration", summary: "Connect your API to PostgreSQL with Prisma", difficulty: "Medium" },
      { id: "t3", title: "JWT Authentication", summary: "Implement secure user authentication with JWT", difficulty: "Hard" },
      { id: "t4", title: "API Rate Limiting", summary: "Protect your API with rate limiting middleware", difficulty: "Medium" },
      { id: "t5", title: "File Upload System", summary: "Handle file uploads with cloud storage integration", difficulty: "Hard" },
      { id: "t6", title: "WebSocket Real-time Features", summary: "Add real-time capabilities to your backend", difficulty: "Hard" },
      { id: "t7", title: "API Documentation", summary: "Document your API with Swagger/OpenAPI", difficulty: "Medium" },
    ],
  },
  "4": {
    id: "4",
    title: "UI/UX Design Sprint",
    description: "Learn design principles, Figma basics, and how to create beautiful, user-friendly interfaces.",
    difficulty: "Beginner",
    taskCount: 4,
    progress: 0,
    tasks: [
      { id: "t1", title: "Design Fundamentals", summary: "Learn color theory, typography, and spacing", difficulty: "Easy" },
      { id: "t2", title: "Figma Basics", summary: "Create your first designs in Figma", difficulty: "Easy" },
      { id: "t3", title: "Mobile-First Design", summary: "Design responsive layouts for all screen sizes", difficulty: "Medium" },
      { id: "t4", title: "Design System Creation", summary: "Build a reusable component library", difficulty: "Medium" },
    ],
  },
};

const difficultyColors = {
  Beginner: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  Intermediate: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  Advanced: "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

const taskDifficultyColors = {
  Easy: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  Medium: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  Hard: "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

const StudentTaskPackDetailPage = () => {
  const navigate = useNavigate();
  const { packId } = useParams<{ packId: string }>();

  const pack = packId ? mockPackDetails[packId] : null;

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
                <CardTitle className="text-2xl">{pack.title}</CardTitle>
              </div>
              <p className="text-muted-foreground max-w-2xl">{pack.description}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className={difficultyColors[pack.difficulty]}>
                  <Zap className="h-3 w-3 mr-1" />
                  {pack.difficulty}
                </Badge>
                <Badge variant="outline" className="bg-muted/50">
                  <BookOpen className="h-3 w-3 mr-1" />
                  {pack.taskCount} Tasks
                </Badge>
              </div>
            </div>
            <Button className="shrink-0">
              Start Pack
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{pack.progress}%</span>
            </div>
            <Progress value={pack.progress} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Task List Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Tasks in this Pack</h3>
        <div className="space-y-3">
          {pack.tasks.map((task, index) => (
            <Card key={task.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
                      {index + 1}
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-medium">{task.title}</h4>
                      <p className="text-sm text-muted-foreground">{task.summary}</p>
                      <Badge variant="outline" className={`${taskDifficultyColors[task.difficulty]} text-xs`}>
                        {task.difficulty}
                      </Badge>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="shrink-0"
                    onClick={() => navigate(`/student/task-packs/${packId}/tasks/${task.id}`)}
                  >
                    <Clock className="h-3 w-3 mr-1" />
                    Start Task
                  </Button>
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
