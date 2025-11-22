
import { useState } from "react";
import StudentHeader from "@/components/dashboard/student/StudentHeader";
import StudentSidebar from "@/components/dashboard/student/StudentSidebar";
import StudentDashboardContent from "@/components/dashboard/student/StudentDashboardContent";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useIsMobile } from "@/hooks/use-mobile";

const StudentDashboard = () => {
  const [activeTab, setActiveTab] = useState("feed");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { profile, loading, refreshProfile } = useStudentProfile();

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
          <StudentDashboardContent activeTab={activeTab} refreshProfile={refreshProfile} />
        </main>
      </div>
    </div>
  );
};

export default StudentDashboard;
