import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface TaskPack {
  id: string;
  name: string;
  description: string | null;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  status: "draft" | "published";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  task_count: number;
}

export interface TaskPackTask {
  id: string;
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  order: number;
  xp: number;
  dueDate: string | null;
}

export interface TaskPackWithTasks extends Omit<TaskPack, 'task_count'> {
  tasks: TaskPackTask[];
}

interface CreatePackData {
  name: string;
  description: string;
  difficulty: string;
  status: string;
  tasks: Array<{
    title: string;
    description: string;
    difficulty: string;
    due_date?: string;
    xp?: number;
  }>;
}

interface UpdatePackData extends CreatePackData {
  packId: string;
}

export const useTaskPacks = (status?: string) => {
  return useQuery({
    queryKey: ["task-packs", status],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_task_packs", {
        p_status: status || null,
      });

      if (error) {
        console.error("Error fetching task packs:", error);
        throw error;
      }

      return (data || []) as TaskPack[];
    },
  });
};

export const useTaskPack = (packId: string | undefined) => {
  return useQuery({
    queryKey: ["task-pack", packId],
    queryFn: async () => {
      if (!packId) return null;

      const { data, error } = await supabase.rpc("get_task_pack_with_tasks", {
        p_pack_id: packId,
      });

      if (error) {
        console.error("Error fetching task pack:", error);
        throw error;
      }

      if (!data || data.length === 0) return null;

      // Transform the flat data into a structured format
      const firstRow = data[0];
      const pack: TaskPackWithTasks = {
        id: firstRow.pack_id,
        name: firstRow.pack_name,
        description: firstRow.pack_description,
        difficulty: firstRow.pack_difficulty as TaskPack["difficulty"],
        status: firstRow.pack_status as TaskPack["status"],
        created_by: null,
        created_at: firstRow.pack_created_at,
        updated_at: firstRow.pack_created_at,
        tasks: data
          .filter((row: any) => row.task_id)
          .map((row: any) => ({
            id: row.task_id,
            title: row.task_title,
            description: row.task_description || "",
            difficulty: "Beginner" as const,
            order: row.task_order,
            xp: row.task_xp || 100,
            dueDate: row.task_due_date,
          })),
      };

      return pack;
    },
    enabled: !!packId,
  });
};

export const useCreateTaskPack = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreatePackData) => {
      const tasksArray = data.tasks.map((task) => ({
        title: task.title,
        description: task.description,
        due_date: task.due_date,
        xp: task.xp,
      }));

      const { data: packId, error } = await supabase.rpc("create_task_pack", {
        p_name: data.name,
        p_description: data.description,
        p_difficulty: data.difficulty,
        p_status: data.status,
        p_tasks: tasksArray,
      });

      if (error) {
        console.error("Error creating task pack:", error);
        throw error;
      }

      return packId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-packs"] });
      toast({
        title: "Success",
        description: "Task pack created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create task pack",
        variant: "destructive",
      });
    },
  });
};

export const useUpdateTaskPack = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: UpdatePackData) => {
      const tasksArray = data.tasks.map((task: any) => ({
        id: task.id || null,
        title: task.title,
        description: task.description,
        due_date: task.due_date,
        xp: task.xp,
      }));

      const { data: success, error } = await supabase.rpc("update_task_pack", {
        p_pack_id: data.packId,
        p_name: data.name,
        p_description: data.description,
        p_difficulty: data.difficulty,
        p_status: data.status,
        p_tasks: tasksArray,
      });

      if (error) {
        console.error("Error updating task pack:", error);
        throw error;
      }

      return success;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task-packs"] });
      queryClient.invalidateQueries({ queryKey: ["task-pack", variables.packId] });
      toast({
        title: "Success",
        description: "Task pack updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update task pack",
        variant: "destructive",
      });
    },
  });
};

export const useDeleteTaskPack = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (packId: string) => {
      const { data: success, error } = await supabase.rpc("delete_task_pack", {
        p_pack_id: packId,
      });

      if (error) {
        console.error("Error deleting task pack:", error);
        throw error;
      }

      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-packs"] });
      toast({
        title: "Success",
        description: "Task pack deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete task pack",
        variant: "destructive",
      });
    },
  });
};
