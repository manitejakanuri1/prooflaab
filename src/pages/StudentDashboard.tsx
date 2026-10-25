
import { useState, useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import StudentHeader from "@/components/dashboard/student/StudentHeader";
import StudentSidebar from "@/components/dashboard/student/StudentSidebar";
import StudentDashboardContent from "@/components/dashboard/student/StudentDashboardContent";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useStudentIntake } from "@/hooks/useStudentIntake";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUrlTab } from "@/hooks/useUrlTab";
import { Button } from "@/components/ui/button";
import { BrandScope } from "@/lib/brandScope";
import "@/components/landing/landing.css";

// Brand look (owner decision 25 Oct 2026): .pl-landing swaps in the brand colours and
// fonts and follows the light/dark switch; BrandScope gives pop-ups the same look.
const Brand = ({ children }: { children: ReactNode }) => (
  <BrandScope.Provider value="pl-landing">
    <div className="pl-landing relative min-h-screen bg-background text-foreground">{children}</div>
  </BrandScope.Provider>
);

/**
 * Four destinations: Floor, Build-log, Squad, Profile.
 *
 * The old task routes still resolve so existing links keep working — they land
 * on the Daily Card, which is where the work is. The default is the Daily Card
 * rather than the feed: a student arriving here should see the one thing they
 * have to do today, not other people's posts on a platform with no posts yet.
 */
const getTabFromPath = (pathname: string): string => {
  if (pathname.startsWith("/student/tasks")) return "lab";
  if (pathname === "/student/roadmap") return "profile";
  return "lab";
};

const StudentDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useUrlTab("tab", getTabFromPath(location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { profile, loading, error: profileError, refreshProfile } = useStudentProfile();
  const { loading: intakeLoading, intakeComplete, degraded: intakeDegraded } = useStudentIntake();

  // Opening the dashboard counts as being here, which is what a college means
  // by "active today". The function records it once per day, so refreshing the
  // page forty times is still one active day — and it never throws, because a
  // student's dashboard must not fail over a statistic.
  useEffect(() => {
    if (!profile?.id) return;
    // .then() is what sends it: a supabase-js query is lazy, and `void` alone
    // never fired this request, so last_active stayed null for everyone.
    supabase.rpc("touch_my_activity" as never).then(() => {}, () => {});
  }, [profile?.id]);

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
      <Brand>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#51A6FB]"></div>
        </div>
      </Brand>
    );
  }

  // The profile could not be read (signed out, not allowed, server or network
  // failure). Say so: the screens below would otherwise render with no profile
  // and read as "no tasks" or "no squad", which is not what happened.
  if (profileError && !profile) {
    return (
      <Brand>
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-sm text-center space-y-4" role="alert">
            <p className="text-sm text-alert">We could not load your profile. Please try again.</p>
            <Button variant="outline" onClick={refreshProfile}>Try again</Button>
          </div>
        </div>
      </Brand>
    );
  }

  return (
    <Brand>
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-25" />
      <div className="pointer-events-none fixed -top-48 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[150px]" />
      <StudentHeader 
        studentName={profile?.full_name || "Student"}
        profilePhoto={profile?.profile_photo_url}
        onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        showMenuButton={isMobile}
      />
      
      <div className="flex relative">
        {/* Mobile overlay */}
        {isMobile && sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        
        {/* Sidebar */}
        <div className={`
          ${isMobile ? 'fixed' : 'sticky top-0'} 
          ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'}
          ${isMobile ? 'z-50' : ''}
          ${isMobile ? 'h-screen' : 'h-screen'}
          transition-transform duration-300 ease-in-out
        `}>
          <StudentSidebar 
            activeTab={activeTab} 
            onTabChange={(tab) => {
              setActiveTab(tab);
              if (isMobile) setSidebarOpen(false);
            }}
          />
        </div>
        
        <main className="relative flex-1 p-3 md:p-6 w-full min-w-0">
          <StudentDashboardContent activeTab={activeTab} refreshProfile={refreshProfile} onTabChange={setActiveTab} />
        </main>
      </div>
    </Brand>
  );
};

export default StudentDashboard;
