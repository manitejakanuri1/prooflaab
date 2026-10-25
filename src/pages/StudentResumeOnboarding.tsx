import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useAuth } from "@/contexts/AuthContext";
import ResumeCheckFlow from "@/components/dashboard/student/ResumeCheckFlow";
import { Button } from "@/components/ui/button";
import { Sparkles, LogOut, ArrowRight } from "lucide-react";
import { BrandFrame } from "@/components/auth/AccessShell";

const StudentResumeOnboarding = () => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { profile, loading: profileLoading } = useStudentProfile();
  const [checkingExisting, setCheckingExisting] = useState(true);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

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

  // The student decides when to leave, not a timer. This used to jump to the
  // dashboard 1.5 seconds after the scorecard appeared — long enough to see
  // that numbers existed, nowhere near long enough to read them.
  const [graded, setGraded] = useState(false);

  if (profileLoading || checkingExisting) {
    return (
      <BrandFrame className="max-w-2xl" logoHome={false}>
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#51A6FB]"></div>
        </div>
      </BrandFrame>
    );
  }

  return (
    // The sign-in page's dark brand frame (owner decision 25 Oct 2026); look only.
    <BrandFrame className="max-w-2xl" logoHome={false}>
      <div>
        <div className="flex justify-end mb-2">
          <button
            onClick={handleSignOut}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
        <div className="text-center mb-8">
          <div className="mono-label inline-flex items-center gap-2 text-primary mb-3">
            <Sparkles className="h-4 w-4" /> Let's build your proof
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold">First, let's check your resume</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload it, see exactly how it scores, fix what's weak, then prove it with a quick quiz.
          </p>
        </div>

        <ResumeCheckFlow onGraded={() => setGraded(true)} />

        {graded && (
          <div className="mt-8 flex justify-center">
            <Button
              size="lg"
              className="h-[3.25rem] w-full sm:w-auto sm:min-w-56 font-mono text-[11px] uppercase tracking-[0.14em]"
              onClick={() => navigate("/student/dashboard", { replace: true })}
            >
              Continue to dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </BrandFrame>
  );
};

export default StudentResumeOnboarding;
