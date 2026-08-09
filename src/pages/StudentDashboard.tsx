
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import StudentHeader from "@/components/dashboard/student/StudentHeader";
import StudentSidebar from "@/components/dashboard/student/StudentSidebar";
import StudentDashboardContent from "@/components/dashboard/student/StudentDashboardContent";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useStudentIntake } from "@/hooks/useStudentIntake";

const getTabFromPath = (pathname: string): string => {
  if (pathname.startsWith("/student/tasks/opportunities")) return "tasks-opportunities";
  if (pathname.startsWith("/student/tasks/assigned")) return "tasks-assigned";
  if (pathname.startsWith("/student/tasks/created")) return "tasks-created";
  if (pathname === "/student/roadmap") return "resume-roadmap";
  return "dashboard";
};

const StudentDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(() => getTabFromPath(location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { profile, loading, refreshProfile } = useStudentProfile();
  const { loading: intakeLoading, intakeComplete, degraded: intakeDegraded } = useStudentIntake();

  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  // A student who hasn't finished intake (welcome + "upload resume vs skip")
  // gets sent back to it instead of seeing the dashboard.
  //
  // Gated on intake_completed_at, NOT on having a resume scorecard: a student
  // who chose "Skip — send me a general task" never produces a scorecard, and
  // the old check would have bounced them back into resume onboarding on every
  // new session.
  useEffect(() => {
    if (intakeLoading || intakeComplete || intakeDegraded) return;
    navigate('/student/start', { replace: true });
  }, [intakeLoading, intakeComplete, intakeDegraded, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <SidebarProvider open={!isMobile || sidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="min-h-screen flex w-full bg-background relative">
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <StudentSidebar
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            if (isMobile) setSidebarOpen(false);
          }}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <StudentHeader
            studentName={profile?.full_name || "Student"}
            profilePhoto={profile?.profile_photo_url}
            onHomeClick={() => setActiveTab("dashboard")}
          />

          <main className="p-3 md:p-6 w-full min-w-0">
            <StudentDashboardContent activeTab={activeTab} refreshProfile={refreshProfile} onTabChange={setActiveTab} />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default StudentDashboard;
