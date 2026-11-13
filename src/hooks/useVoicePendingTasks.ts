import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { taskMatchesSkill } from "@/lib/taskMatchesSkill";

export { taskMatchesSkill };

export interface VoicePendingTask {
  id: string;
  title: string;
  category?: string | null;
  skills: string[];
}

export const useVoicePendingTasks = (studentId?: string | null) =>
  useQuery({
    queryKey: ["voice-pending-tasks", studentId],
    enabled: Boolean(studentId),
    queryFn: async (): Promise<VoicePendingTask[]> => {
      if (!studentId) return [];

      // Get passed submissions for this student
      const { data: subs, error: subErr } = await supabase
        .from("task_submissions")
        .select("task_id, tasks:task_id (id, title, category, lot_category, required_skills)")
        .eq("student_id", studentId)
        .eq("status", "passed");

      if (subErr || !subs) return [];

      // Get all scored voices by this student that are not withdrawn
      const { data: voices } = await supabase
        .from("voice_explanations")
        .select("task_id")
        .eq("student_id", studentId)
        .eq("status", "scored")
        .is("withdrawn_at" as never, null);

      const scoredTasks = new Set((voices ?? []).map((v) => v.task_id).filter(Boolean));
      const pendingMap = new Map<string, VoicePendingTask>();

      for (const s of subs) {
        if (!s.task_id || scoredTasks.has(s.task_id)) continue;
        const taskInfo = (s as unknown as {
          tasks: {
            id: string;
            title: string;
            category?: string | null;
            lot_category?: string | null;
            required_skills?: string[];
          } | null;
        }).tasks;

        if (taskInfo && !pendingMap.has(s.task_id)) {
          pendingMap.set(s.task_id, {
            id: s.task_id,
            title: taskInfo.title,
            category: taskInfo.lot_category || taskInfo.category,
            skills: taskInfo.required_skills ?? [],
          });
        }
      }

      return Array.from(pendingMap.values());
    },
  });
