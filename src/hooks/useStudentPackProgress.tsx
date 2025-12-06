import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface TaskProgress {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  taskOrder: number;
  isCompleted: boolean;
}

interface PackProgress {
  packId: string;
  packName: string;
  packDescription: string | null;
  packDifficulty: string;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
  tasks: TaskProgress[];
}

export const useStudentPackProgress = (packId?: string) => {
  return useQuery({
    queryKey: ["student-pack-progress", packId],
    queryFn: async () => {
      // Get current student profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: studentProfile } = await supabase
        .from("student_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!studentProfile) return null;

      // Fetch pack with tasks
      const { data: packData, error: packError } = await supabase.rpc(
        "get_task_pack_with_tasks",
        { p_pack_id: packId }
      );

      if (packError || !packData || packData.length === 0) return null;

      const firstRow = packData[0];
      const taskIds = packData
        .filter((row: any) => row.task_id)
        .map((row: any) => row.task_id);

      // Fetch completed proofs for these tasks
      const { data: completedProofs } = await supabase
        .from("proof_uploads")
        .select("task_id")
        .eq("student_id", studentProfile.id)
        .eq("status", "Verified")
        .in("task_id", taskIds);

      const completedTaskIds = new Set(
        (completedProofs || []).map((p) => p.task_id)
      );

      const tasks: TaskProgress[] = packData
        .filter((row: any) => row.task_id)
        .map((row: any) => ({
          taskId: row.task_id,
          taskTitle: row.task_title,
          taskDescription: row.task_description || "",
          taskOrder: row.task_order,
          isCompleted: completedTaskIds.has(row.task_id),
        }));

      const completedCount = tasks.filter((t) => t.isCompleted).length;
      const progressPercent =
        tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

      return {
        packId: firstRow.pack_id,
        packName: firstRow.pack_name,
        packDescription: firstRow.pack_description,
        packDifficulty: firstRow.pack_difficulty,
        totalTasks: tasks.length,
        completedTasks: completedCount,
        progressPercent,
        tasks,
      } as PackProgress;
    },
    enabled: !!packId,
  });
};

export const useStudentAllPacksProgress = () => {
  return useQuery({
    queryKey: ["student-all-packs-progress"],
    queryFn: async () => {
      // Get current student profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: studentProfile } = await supabase
        .from("student_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      // Fetch all published packs
      const { data: packs, error: packsError } = await supabase.rpc(
        "get_task_packs",
        { p_status: "published" }
      );

      if (packsError || !packs) return [];

      // For each pack, calculate progress
      const progressPromises = packs.map(async (pack: any) => {
        const { data: packTasks } = await supabase.rpc(
          "get_task_pack_with_tasks",
          { p_pack_id: pack.id }
        );

        const taskIds = (packTasks || [])
          .filter((row: any) => row.task_id)
          .map((row: any) => row.task_id);

        let completedCount = 0;

        if (studentProfile && taskIds.length > 0) {
          const { data: completedProofs } = await supabase
            .from("proof_uploads")
            .select("task_id")
            .eq("student_id", studentProfile.id)
            .eq("status", "Verified")
            .in("task_id", taskIds);

          completedCount = (completedProofs || []).length;
        }

        const totalTasks = taskIds.length;
        const progressPercent =
          totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

        return {
          id: pack.id,
          name: pack.name,
          description: pack.description,
          difficulty: pack.difficulty,
          taskCount: totalTasks,
          progress: progressPercent,
          completedTasks: completedCount,
        };
      });

      return Promise.all(progressPromises);
    },
  });
};
