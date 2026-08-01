
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import StudentHeader from "@/components/dashboard/student/StudentHeader";
import StudentSidebar from "@/components/dashboard/student/StudentSidebar";
import StudentDashboardContent from "@/components/dashboard/student/StudentDashboardContent";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";

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
  const [resumeChecked, setResumeChecked] = useState(false);

  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  // A student who hasn't finished the mandatory resume-onboarding flow (upload,
  // feedback, confirm, quiz) gets sent there instead of seeing the dashboard at
  // all. Only steers the bare "/student/dashboard" landing, and only once per
  // session, so a student mid-flow who navigates elsewhere isn't yanked back.
  useEffect(() => {
    if (resumeChecked || !profile?.id) return;
    if (location.pathname !== "/student/dashboard") {
      setResumeChecked(true);
      return;
    }
    supabase
      .from('resume_scorecards')
      .select('id')
      .eq('student_id', profile.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          navigate('/student/resume-onboarding', { replace: true });
        }
        setResumeChecked(true);
      });
  }, [profile?.id, location.pathname, resumeChecked, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
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
        
        <main className="flex-1 p-3 md:p-6 w-full min-w-0">
          <StudentDashboardContent activeTab={activeTab} refreshProfile={refreshProfile} onTabChange={setActiveTab} />
        </main>
      </div>
    </div>
  );
};

export default StudentDashboard;
