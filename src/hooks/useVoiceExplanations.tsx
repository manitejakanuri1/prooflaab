import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface VoiceExplanation {
  id: string;
  transcript: string | null;
  transcript_source: "browser" | "server" | "manual" | null;
  transcription_status: "pending" | "processing" | "completed" | "failed" | null;
  transcription_error: string | null;
  communication_score: number | null;
  communication_notes: string | null;
  status: string | null;
  created_at: string;
  task_id: string | null;
  storage_path: string;
  tasks?: { title: string } | null;
}

/**
 * The student's own recorded explanations, for the Build-Log / My Uploads
 * view (Step 6G). Step 6F found no destination for these once the modal
 * said "Saved" - this is that destination, kept intentionally separate
 * from useProofUploads: a recording is not a proof, has no review status,
 * and its own status (transcribing vs a code submission's Under Review) is
 * a different concept a shared query would blur.
 *
 * RLS (voice_own_read) already scopes every row to student_id = auth.uid()
 * - this can never return another student's recording.
 */
export const useVoiceExplanations = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["voice-explanations", user?.id],
    queryFn: async (): Promise<VoiceExplanation[]> => {
      if (!user) return [];

      const { data: profile } = await supabase
        .from("student_profiles").select("id").eq("user_id", user.id).maybeSingle();
      if (!profile) return [];

      // types.ts predates migrations 41-43 (transcription_status and
      // friends) - same reason VoiceExplainModal.tsx already casts these.
      const { data, error } = await supabase
        .from("voice_explanations")
        .select("id, transcript, transcript_source, transcription_status, transcription_error, communication_score, communication_notes, status, created_at, task_id, storage_path, tasks(title)")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(20)
        .then((r) => r as unknown as { data: VoiceExplanation[] | null; error: unknown });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user),
  });
};
