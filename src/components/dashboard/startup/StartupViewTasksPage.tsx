import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, Clock, Users, Eye, Edit, Trash2 } from "lucide-react";

const mockTasks = [
  {
    id: 1,
    title: "React Frontend Development",
    category: "Frontend",
    description: "Build a responsive dashboard using React and Tailwind CSS",
    duration: 7,
    xp: 100,
    difficulty: "Intermediate",
    submissions: 12,
    postedDate: "2024-01-15",
    status: "Active"
  },
  {
    id: 2,
    title: "Mobile App UI Design",
    category: "Design",
    description: "Design a modern mobile app interface for a fitness tracking application",
    duration: 5,
    xp: 80,
    difficulty: "Beginner",
    submissions: 8,
    postedDate: "2024-01-10",
    status: "Active"
  },
  {
    id: 3,
    title: "API Integration",
    category: "Backend",
    description: "Integrate third-party APIs and create documentation",
    duration: 10,
    xp: 150,
    difficulty: "Advanced",
    submissions: 5,
    postedDate: "2024-01-05",
    status: "Closed"
  }
];

export function StartupViewTasksPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Posted Tasks</h2>
          <p className="text-muted-foreground">Manage your internship tasks</p>
        </div>
        <Button>Post New Task</Button>
      </div>

      <div className="flex gap-4 mb-6">
        <Input placeholder="Search tasks..." className="max-w-sm" />
        <Button variant="outline">Filter</Button>
      </div>

      <div className="grid gap-4">
        {mockTasks.map((task) => (
          <Card key={task.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{task.title}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                </div>
                <Badge variant={task.status === 'Active' ? 'default' : 'secondary'}>
                  {task.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>Posted {task.postedDate}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{task.duration} days</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span>{task.submissions} submissions</span>
                  </div>
                  <div>
                    <Badge variant="outline">{task.difficulty}</Badge>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}