
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
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
  if (pathname.match(/^\/student\/task-packs\/[^/]+\/tasks\/[^/]+$/)) return "task-pack-task";
  if (pathname.match(/^\/student\/task-packs\/[^/]+$/)) return "task-pack-detail";
  if (pathname === "/student/task-packs") return "task-packs";
  if (pathname === "/student/pack-leaderboard") return "pack-leaderboard";
  return "dashboard";
};

const StudentDashboard = () => {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(() => getTabFromPath(location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { profile, loading, refreshProfile } = useStudentProfile();
  const [resumeChecked, setResumeChecked] = useState(false);

  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  // First stop after login: if this student has never confirmed a resume,
  // land them on Resume Check instead of the dashboard. Only steers the bare
  // "/student/dashboard" landing — any other tab/link the student picked
  // directly is left alone, and it only runs once per session.
  useEffect(() => {
    if (resumeChecked || !profile?.id) return;
    if (location.pathname !== "/student/dashboard") {
      setResumeChecked(true);
      return;
    }
    supabase
      .from('resume_claims')
      .select('status')
      .eq('student_id', profile.id)
      .eq('status', 'confirmed')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setActiveTab('resume');
        setResumeChecked(true);
      });
  }, [profile?.id, location.pathname, resumeChecked]);

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
