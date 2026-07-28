import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import ResumeCheckFlow from "@/components/dashboard/student/ResumeCheckFlow";
import { Sparkles } from "lucide-react";

const StudentResumeOnboarding = () => {
  const navigate = useNavigate();
  const { profile, loading: profileLoading } = useStudentProfile();
  const [checkingExisting, setCheckingExisting] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("resume_scorecards")
      .select("id")
      .eq("student_id", profile.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          navigate("/student/dashboard", { replace: true });
        } else {
          setCheckingExisting(false);
        }
      });
  }, [profile?.id, navigate]);

  const handleGraded = () => {
    setTimeout(() => navigate("/student/dashboard", { replace: true }), 1500);
  };

  if (profileLoading || checkingExisting) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-background dark:from-orange-950/20 dark:to-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-orange-600 dark:text-orange-400 font-semibold text-sm mb-2">
            <Sparkles className="h-4 w-4" /> Let's build your proof
          </div>
          <h1 className="text-2xl font-bold">First, let's check your resume</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload it, see exactly how it scores, fix what's weak, then prove it with a quick quiz.
          </p>
        </div>

        <ResumeCheckFlow onGraded={handleGraded} />
      </div>
    </div>
  );
};

export default StudentResumeOnboarding;
