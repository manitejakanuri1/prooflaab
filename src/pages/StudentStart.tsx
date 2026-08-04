import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStudentIntake, type TaskSource } from "@/hooks/useStudentIntake";
import WelcomeScreen from "@/components/onboarding/WelcomeScreen";
import IntakeChoice from "@/components/onboarding/IntakeChoice";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

/**
 * A self-signup student gets an auth.users row but no student_profiles row —
 * only the CSV bulk-invite and admin paths create one. resume-parser looks that
 * row up and 404s "Student profile not found" without it, so the resume upload
 * would fail for every new signup. Create it before the student can reach the
 * upload button.
 */
const ensureStudentProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from("student_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return;

  const { error } = await supabase.from("student_profiles").insert({
    user_id: user.id,
    email: user.email ?? "",
    full_name:
      (user.user_metadata?.full_name as string | undefined) ||
      user.email?.split("@")[0] ||
      "Student",
    profile_completed: false,
  });
  // A duplicate just means a parallel path already created it.
  if (error && !error.message.toLowerCase().includes("duplicate")) {
    console.error("Could not create student profile:", error.message);
  }
};

/**
 * The post-email-confirmation entry point for students:
 *
 *   1.1 Welcome (once)  ->  2.2 Upload resume | Skip  ->  dashboard
 *
 * A student who has already finished intake is sent straight to the dashboard,
 * so this route can never trap anyone.
 */
const StudentStart = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    loading,
    degraded,
    hasSeenWelcome,
    intakeComplete,
    markWelcomeSeen,
    completeIntake,
  } = useStudentIntake();
  const [starting, setStarting] = useState(false);

  // `degraded` means the intake row could not be read at all. Showing a blocking
  // welcome we cannot dismiss would strand the student, so pass them through.
  const passThrough = intakeComplete || degraded;

  useEffect(() => {
    ensureStudentProfile();
  }, []);

  useEffect(() => {
    if (!loading && passThrough) {
      navigate("/student/dashboard", { replace: true });
    }
  }, [loading, passThrough, navigate]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await markWelcomeSeen();
    } catch (err) {
      toast({
        title: "Something went wrong",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setStarting(false);
    }
  };

  const handleIntakeDone = async (source: TaskSource) => {
    await completeIntake(source);
    navigate("/student/dashboard", { replace: true });
  };

  if (loading || passThrough) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!hasSeenWelcome) {
    return <WelcomeScreen onStart={handleStart} starting={starting} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen flex items-center justify-center px-6 py-16">
        <IntakeChoice onDone={handleIntakeDone} />
      </div>
    </div>
  );
};

export default StudentStart;
