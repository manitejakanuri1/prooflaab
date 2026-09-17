import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type TaskSource = "resume" | "general";

export interface StudentIntake {
  user_id: string;
  has_seen_welcome: boolean;
  welcome_seen_at: string | null;
  task_source: TaskSource | null;
  intake_completed_at: string | null;
}

/**
 * State for the post-email-confirmation flow: the one-time welcome screen and
 * the "upload resume vs skip" choice that follows it.
 *
 * The row is created lazily on first write rather than by a signup trigger, so
 * a student who never reaches the flow simply has no row (treated as "nothing
 * done yet").
 */
export const useStudentIntake = () => {
  const [intake, setIntake] = useState<StudentIntake | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [graded, setGraded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchIntake = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUserId(null);
      setIntake(null);
      setLoading(false);
      return;
    }
    setUserId(user.id);

    // A graded test also counts as intake done. Intake was otherwise only
    // marked complete when the student clicked "Done" on the results screen, so
    // closing the tab there sent them round the whole test again, every visit.
    const [{ data, error }, { data: scorecard }] = await Promise.all([
      supabase.from("student_intake").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("resume_scorecards").select("id, student_profiles!inner(user_id)")
        .eq("student_profiles.user_id", user.id).limit(1).maybeSingle(),
    ]);
    setGraded(Boolean(scorecard));

    // Fail open. This state drives a blocking gate, so if the table is missing
    // (migration not applied yet) or the read fails, we must not lock every
    // student out of the dashboard — callers skip the redirect when degraded.
    if (error) {
      console.error("Failed to load intake state:", error.message);
      setDegraded(true);
    } else {
      setDegraded(false);
    }
    setIntake((data as StudentIntake) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchIntake();
  }, [fetchIntake]);

  const upsert = useCallback(
    async (patch: Partial<Omit<StudentIntake, "user_id">>) => {
      const id = userId ?? (await supabase.auth.getUser()).data.user?.id;
      if (!id) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("student_intake")
        .upsert(
          { user_id: id, ...patch, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        )
        .select()
        .single();

      if (error) throw error;
      setIntake(data as StudentIntake);
      return data as StudentIntake;
    },
    [userId]
  );

  /** 1.1 Welcome dismissed via [Start]. */
  const markWelcomeSeen = useCallback(
    () => upsert({ has_seen_welcome: true, welcome_seen_at: new Date().toISOString() }),
    [upsert]
  );

  /** 2.2 resolved — either a resume was read, or the student skipped. */
  const completeIntake = useCallback(
    (source: TaskSource) =>
      upsert({
        has_seen_welcome: true,
        task_source: source,
        intake_completed_at: new Date().toISOString(),
      }),
    [upsert]
  );

  return {
    intake,
    loading,
    degraded,
    hasSeenWelcome: intake?.has_seen_welcome ?? false,
    intakeComplete: Boolean(intake?.intake_completed_at) || graded,
    markWelcomeSeen,
    completeIntake,
    refresh: fetchIntake,
  };
};
