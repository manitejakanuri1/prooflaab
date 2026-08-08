import { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Makes sure a signed-in student has a row in student_profiles.
 *
 * Signup used to write the same person into two tables: `students` (name,
 * email, user_id and nothing else) and `student_profiles` (everything the
 * product actually reads). Four separate code paths did the double write, so
 * the two tables drifted apart and only one of them was ever read back.
 *
 * `student_profiles` is the real one. This is now the single place a profile
 * gets created, called from the auth listener and from the onboarding screen.
 */
export const ensureStudentProfile = async (user: User): Promise<void> => {
  try {
    const { data: existingProfile } = await supabase
      .from("student_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingProfile) return;

    // Only students get a student profile.
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleData?.role !== "student") return;

    const { error } = await supabase.from("student_profiles").upsert(
      [
        {
          user_id: user.id,
          full_name:
            user.user_metadata?.full_name || user.email?.split("@")[0] || "Student",
          email: user.email || "",
          total_xp: 0,
          trust_score: 0,
        },
      ],
      { onConflict: "user_id" },
    );

    if (error) {
      console.error("Error creating student profile:", error);
    }
  } catch (error) {
    console.error("Error checking/creating student profile:", error);
  }
};
