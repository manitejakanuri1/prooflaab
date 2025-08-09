
import { useState } from "react";
import StudentHeader from "@/components/dashboard/student/StudentHeader";
import StudentSidebar from "@/components/dashboard/student/StudentSidebar";
import StudentDashboardContent from "@/components/dashboard/student/StudentDashboardContent";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useIsMobile } from "@/hooks/use-mobile";

const StudentDashboard = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { profile, loading, refreshProfile } = useStudentProfile();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  console.log("Student Dashboard - Profile data:", profile);
  console.log("Student Dashboard - Profile full_name:", profile?.full_name);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
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
          ${isMobile ? 'fixed' : 'relative'} 
          ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'}
          ${isMobile ? 'z-50' : ''}
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
