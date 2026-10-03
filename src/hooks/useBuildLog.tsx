import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The student's Build-log: their real work and its evidence, nothing else.
 *
 * Sources (Wave 5, 3 Oct 2026): task_submissions (every graded attempt) and
 * voice_explanations (the spoken explanation of that work). The retired proof
 * system (proof_uploads, conceptual tests, appeals, reflections) is not read.
 * RLS scopes both tables to the student's own rows.
 */
export interface BuildLogVoice {
  id: string;
  status: string | null;                 // pending | scored | failed
  transcription_status: string | null;   // pending | processing | completed | failed
  communication_score: number | null;
  communication_notes: string | null;
  transcript: string | null;
  created_at: string;
}

export interface BuildLogEntry {
  task_id: string;
  title: string;
  lot_date: string | null;
  source_jd: string | null;
  lot_category: string | null;
  kind: "code" | "written";
  status: string;                        // passed | failed | needs_review (latest attempt)
  score: number | null;
  passed_count: number | null;
  total_count: number | null;
  language: string | null;
  work: string | null;
  feedback: { criterion_id: string; points: number; evidence: string }[] | null;
  submitted_at: string;
  attempts: number;
  voice: BuildLogVoice | null;
}

/** True while some voice explanation is still being transcribed or scored. */
export const voiceInProgress = (v: BuildLogVoice | null) =>
  !!v && v.status !== "scored" && v.status !== "failed";

export const useBuildLog = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["build-log", user?.id],
    queryFn: async (): Promise<BuildLogEntry[]> => {
      if (!user) return [];
      const { data: profile } = await supabase.from("student_profiles").select("id").eq("user_id", user.id).maybeSingle();
      if (!profile) return [];
      const [subs, voices] = await Promise.all([
        supabase.from("task_submissions")
          .select("id, task_id, status, sandbox_score, passed_count, total_count, language, code, rubric_scores, sandbox_config_id, created_at, tasks(title, lot_date, source_jd, lot_category)")
          .eq("student_id", profile.id).order("created_at", { ascending: false }).limit(200),
        supabase.from("voice_explanations")
          .select("id, task_id, status, transcription_status, communication_score, communication_notes, transcript, created_at")
          .eq("student_id", profile.id).order("created_at", { ascending: false }).limit(200),
      ]);
      if (subs.error) throw subs.error;
      if (voices.error) throw voices.error;

      // Best voice per task: a scored one wins, otherwise the newest.
      const voiceByTask = new Map<string, BuildLogVoice>();
      for (const v of (voices.data ?? []) as unknown as (BuildLogVoice & { task_id: string | null })[]) {
        if (!v.task_id) continue;
        const have = voiceByTask.get(v.task_id);
        if (!have || (v.status === "scored" && have.status !== "scored")) voiceByTask.set(v.task_id, v);
      }

      const byTask = new Map<string, BuildLogEntry>();
      for (const s of (subs.data ?? []) as unknown as Record<string, any>[]) {
        const existing = byTask.get(s.task_id);
        if (existing) { existing.attempts++; continue; }   // rows are newest first
        byTask.set(s.task_id, {
          task_id: s.task_id,
          title: s.tasks?.title ?? "Task",
          lot_date: s.tasks?.lot_date ?? null,
          source_jd: s.tasks?.source_jd ?? null,
          lot_category: s.tasks?.lot_category ?? null,
          kind: s.sandbox_config_id ? "code" : "written",
          status: s.status,
          score: s.sandbox_score,
          passed_count: s.passed_count,
          total_count: s.total_count,
          language: s.language,
          work: s.code,
          feedback: Array.isArray(s.rubric_scores) ? s.rubric_scores : null,
          submitted_at: s.created_at,
          attempts: 1,
          voice: voiceByTask.get(s.task_id) ?? null,
        });
      }
      return [...byTask.values()];
    },
    enabled: Boolean(user),
    // Poll only while a spoken explanation is still being processed, then stop.
    refetchInterval: (query) =>
      (query.state.data as BuildLogEntry[] | undefined)?.some((e) => voiceInProgress(e.voice)) ? 8000 : false,
    refetchOnWindowFocus: true,
  });
};
