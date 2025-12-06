import React from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import AdminTaskPackForm from "./AdminTaskPackForm";
import { useTaskPack } from "@/hooks/useTaskPacks";

const AdminTaskPackEditPage = () => {
  const { packId } = useParams();
  const { data: pack, isLoading, error } = useTaskPack(packId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !pack) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Pack not found: {packId}</p>
      </div>
    );
  }

  // Transform API data to form format
  const formData = {
    id: pack.id,
    title: pack.name,
    description: pack.description || "",
    difficulty: pack.difficulty,
    isPublished: pack.status === "published",
    tasks: pack.tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      difficulty: task.difficulty,
      order: task.order,
      dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
      xp: task.xp || 100,
    })),
  };

  return (
    <AdminTaskPackForm 
      mode="edit" 
      initialData={formData}
      packId={packId}
    />
  );
};

export default AdminTaskPackEditPage;
