import React from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Edit, Trash2, Eye, Package, Loader2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTaskPacks, useDeleteTaskPack, TaskPack } from "@/hooks/useTaskPacks";

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
    case "published":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "draft":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const AdminTaskPacksPage = () => {
  const navigate = useNavigate();
  const { data: packs, isLoading, error } = useTaskPacks();
  const deletePackMutation = useDeleteTaskPack();

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
    deletePackMutation.mutate(packId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Error loading task packs</p>
      </div>
    );
  }

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
          {!packs || packs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p>No task packs yet</p>
              <p className="text-sm">Create your first pack to get started</p>
            </div>
          ) : (
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
                  {packs.map((pack) => (
                    <TableRow key={pack.id}>
                      <TableCell className="font-medium">{pack.name}</TableCell>
                      <TableCell className="hidden md:table-cell max-w-xs truncate text-muted-foreground">
                        {pack.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={getDifficultyColor(pack.difficulty)}>
                          {pack.difficulty}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">{pack.task_count}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={getStatusColor(pack.status)}>
                          {pack.status === "published" ? "Published" : "Draft"}
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
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Delete Pack"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Task Pack</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{pack.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeletePack(pack.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
    </div>
  );
};

export default AdminTaskPacksPage;
