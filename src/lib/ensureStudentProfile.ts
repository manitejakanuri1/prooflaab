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
    const { data: existingProfile, error: readError } = await supabase
      .from("student_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    // A failed read (timeout, busy API) says nothing about whether the profile exists. Treating it as
    // "missing" re-created the profile over the real one: the name became the email prefix (seen on
    // staging 6 Oct 2026). Do nothing now; the next sign-in or page load tries again.
    if (readError || existingProfile) return;

    // Only students get a student profile.
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || roleData?.role !== "student") return;

    // No email here. It moved to student_contact, and a trigger on
    // student_profiles copies it across from the auth account, which is where
    // it was really coming from all along.
    // Insert only: if a profile exists after all (a race, or a read that missed it), it is left as it is.
    const { error } = await supabase.from("student_profiles").upsert(
      [
        {
          user_id: user.id,
          full_name:
            user.user_metadata?.full_name || user.email?.split("@")[0] || "Student",
          total_xp: 0,
        },
      ],
      { onConflict: "user_id", ignoreDuplicates: true },
    );

    if (error) {
      console.error("Error creating student profile:", error);
    }
  } catch (error) {
    console.error("Error checking/creating student profile:", error);
  }
};
