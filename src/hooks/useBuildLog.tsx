import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The student's Build-log: their real work and its evidence, nothing else.
 *
 * Sources (Wave 5, 3 Oct 2026): task_submissions (every graded attempt) and
 * voice_explanations (the spoken explanation of that work). The retired proof
 * system (the retired upload table, conceptual tests, appeals, reflections) is not read.
 * RLS scopes both tables to the student's own rows.
 */
export interface BuildLogVoice {
  id: string;
  status: string | null;                 // pending | scored | failed
  transcription_status: string | null;   // pending | processing | completed | failed
  communication_score: number | null;
  communication_notes: string | null;
  transcript: string | null;
  /** evaluator metadata: content_match (0-100), flags, and what the transcriber heard. */
  evaluation: { content_match?: number | null; flags?: string[]; transcription?: { gate?: string; language?: string } } | null;
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
  /** tasks.status: pending_voice / completed = the Daily Lot is handed in (QA round 2 item 10). */
  task_status?: string | null;
  score: number | null;
  passed_count: number | null;
  total_count: number | null;
  language: string | null;
  work: string | null;
  feedback: { criterion_id: string; points: number; evidence: string; to_improve?: string }[] | null;
  submitted_at: string;
  /** Daily Lot only: the coding/answer mark that counts (my_lot_marks, migration 218), out of 10. */
  counted?: number | null;
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
      const [subs, voices, counted] = await Promise.all([
        supabase.from("task_submissions")
          .select("id, task_id, status, sandbox_score, passed_count, total_count, language, code, rubric_scores, sandbox_config_id, created_at, tasks(title, lot_date, source_jd, lot_category, status)")
          .eq("student_id", profile.id).order("created_at", { ascending: false }).limit(200),
        supabase.from("voice_explanations")
          .select("id, task_id, submission_id, current_authoritative, attempt_no, status, transcription_status, communication_score, communication_notes, transcript, evaluation, created_at")
          .eq("student_id", profile.id).is("withdrawn_at" as never, null).order("created_at", { ascending: false }).limit(200),
        // QA round 2 item 21: the mark that counts for each Daily Lot (same number as the Daily Card).
        supabase.rpc("my_lot_marks" as never),
      ]);
      const countedBy = new Map(((counted.data ?? []) as unknown as { task_id: string; coding_mark: number }[])
        .map((m) => [m.task_id, Number(m.coding_mark)]));
      if (subs.error) throw subs.error;
      if (voices.error) throw voices.error;

      // The explanation of a submission = its authoritative recording, else its
      // newest one (rows are newest first). Older rows without a binding fall back
      // to the task.
      type V = BuildLogVoice & { task_id: string | null; submission_id: string | null; current_authoritative: boolean };
      const voiceBySubmission = new Map<string, V>();
      const voiceByTask = new Map<string, V>();
      // Sweep M4: a recording bound to an earlier try of the same Lot still belongs to the Lot.
      const anyVoiceByTask = new Map<string, V>();
      for (const v of (voices.data ?? []) as unknown as V[]) {
        if (v.task_id && !anyVoiceByTask.has(v.task_id)) anyVoiceByTask.set(v.task_id, v);
        if (v.submission_id) {
          const have = voiceBySubmission.get(v.submission_id);
          if (!have || (v.current_authoritative && !have.current_authoritative)) voiceBySubmission.set(v.submission_id, v);
        } else if (v.task_id && !voiceByTask.has(v.task_id)) voiceByTask.set(v.task_id, v);
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
          task_status: s.tasks?.status ?? null,
          score: s.sandbox_score,
          passed_count: s.passed_count,
          total_count: s.total_count,
          language: s.language,
          work: s.code,
          feedback: Array.isArray(s.rubric_scores) ? s.rubric_scores : null,
          submitted_at: s.created_at,
          counted: countedBy.get(s.task_id) ?? null,
          attempts: 1,
          voice: voiceBySubmission.get(s.id) ?? voiceByTask.get(s.task_id) ?? anyVoiceByTask.get(s.task_id) ?? null,
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
