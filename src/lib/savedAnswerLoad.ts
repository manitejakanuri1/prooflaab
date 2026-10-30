import { supabase } from "@/integrations/supabase/client";
import { bestSaved, type SavedRow } from "./savedAnswer";

/** The student's best saved answer for a task and their first scored voice (RLS: own rows only). */
export async function loadSavedAnswer(taskId: string): Promise<{ row: SavedRow; voice: number | null } | null> {
  const [subs, voice] = await Promise.all([
    supabase.from("task_submissions" as never)
      .select("code, passed_count, total_count, sandbox_score, status, created_at").eq("task_id", taskId),
    supabase.from("voice_explanations" as never)
      .select("communication_score, created_at").eq("task_id", taskId).eq("status", "scored")
      .is("withdrawn_at", null).order("created_at").limit(1),
  ]);
  const row = bestSaved((subs.data ?? []) as unknown as SavedRow[]);
  if (!row) return null;
  const v = (voice.data ?? []) as unknown as { communication_score: number | null }[];
  return { row, voice: v[0]?.communication_score ?? null };
}
