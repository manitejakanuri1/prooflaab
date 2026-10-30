import { supabase } from "@/integrations/supabase/client";
import { voiceStatusOf, type VoiceStatus } from "./voiceStatusText";

export * from "./voiceStatusText";

export async function latestVoiceStatus(studentId: string, taskId: string): Promise<VoiceStatus> {
  const { data } = await supabase
    .from("voice_explanations")
    .select("status")
    .eq("student_id", studentId)
    .eq("task_id", taskId)
    .is("withdrawn_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return voiceStatusOf((data as { status?: string } | null)?.status);
}
