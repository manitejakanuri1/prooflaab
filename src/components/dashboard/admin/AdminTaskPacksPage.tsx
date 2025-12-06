import React from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Edit, Trash2, Eye, Package } from "lucide-react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TaskPack {
  id: string;
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  taskCount: number;
  status: "Published" | "Draft";
}

const mockTaskPacks: TaskPack[] = [
  {
    id: "pack-1",
    title: "Full Stack Beginner Pack",
    description: "Learn the fundamentals of full stack development with hands-on projects.",
    difficulty: "Beginner",
    taskCount: 5,
    status: "Published",
  },
  {
    id: "pack-2",
    title: "React Advanced Patterns",
    description: "Master advanced React patterns including hooks, context, and performance optimization.",
    difficulty: "Advanced",
    taskCount: 8,
    status: "Published",
  },
  {
    id: "pack-3",
    title: "API Design Fundamentals",
    description: "Build RESTful APIs with proper authentication, validation, and documentation.",
    difficulty: "Intermediate",
    taskCount: 6,
    status: "Draft",
  },
  {
    id: "pack-4",
    title: "Data Structures & Algorithms",
    description: "Strengthen your problem-solving skills with common DSA challenges.",
    difficulty: "Intermediate",
    taskCount: 10,
    status: "Published",
  },
  {
    id: "pack-5",
    title: "Cloud Deployment Basics",
    description: "Deploy applications to cloud platforms with CI/CD pipelines.",
    difficulty: "Beginner",
    taskCount: 4,
    status: "Draft",
  },
];

const getDifficultyColor = (difficulty: TaskPack["difficulty"]) => {
  switch (difficulty) {
    case "Beginner":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "Intermediate":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "Advanced":
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getStatusColor = (status: TaskPack["status"]) => {
  switch (status) {
    case "Published":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "Draft":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const AdminTaskPacksPage = () => {
  const navigate = useNavigate();

  const handleCreatePack = () => {
    navigate("/admin/task-packs/create");
  };

  const handleEditPack = (packId: string) => {
    navigate(`/admin/task-packs/${packId}/edit`);
  };

  const handleViewTasks = (packId: string) => {
    navigate(`/admin/task-packs/${packId}`);
  };

  const handleDeletePack = (packId: string) => {
    // Placeholder - will be implemented later
    console.log("Delete pack:", packId);
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Package className="h-7 w-7 text-primary" />
            Task Packs
          </h1>
          <p className="text-muted-foreground mt-1">
            Create and manage task packs for students
          </p>
        </div>
        <Button onClick={handleCreatePack} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Pack
        </Button>
      </div>

      {/* Task Packs Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Task Packs</CardTitle>
          <CardDescription>
            Manage your task packs and their contents
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead className="text-center">Tasks</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockTaskPacks.map((pack) => (
                  <TableRow key={pack.id}>
                    <TableCell className="font-medium">{pack.title}</TableCell>
                    <TableCell className="hidden md:table-cell max-w-xs truncate text-muted-foreground">
                      {pack.description}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={getDifficultyColor(pack.difficulty)}>
                        {pack.difficulty}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{pack.taskCount}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={getStatusColor(pack.status)}>
                        {pack.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewTasks(pack.id)}
                          className="h-8 w-8"
                          title="View Tasks"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditPack(pack.id)}
                          className="h-8 w-8"
                          title="Edit Pack"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeletePack(pack.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Delete Pack"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminTaskPacksPage;
