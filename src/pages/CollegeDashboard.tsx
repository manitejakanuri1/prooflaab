import { useState } from "react";
import CollegeDashboardHeader from "@/components/dashboard/college/CollegeDashboardHeader";
import CollegeDashboardSidebar from "@/components/dashboard/college/CollegeDashboardSidebar";
import CollegeDashboardContent from "@/components/dashboard/college/CollegeDashboardContent";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCollegeProfile } from "@/hooks/useCollegeProfile";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";

const CollegeDashboard = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { profile, loading } = useCollegeProfile();

  // Show loading state or use fallback data
  const collegeData = {
    name: profile?.college_name || profile?.name || "Loading...",
    email: profile?.email || "",
    profilePhoto: profile?.profile_photo_url || null,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <CollegeDashboardHeader 
        collegeName={collegeData.name}
        profilePhoto={collegeData.profilePhoto}
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
          <CollegeDashboardSidebar 
            activeTab={activeTab} 
            onTabChange={(tab) => {
              setActiveTab(tab);
              if (isMobile) setSidebarOpen(false);
            }}
          />
        </div>
        
        <main className="flex-1 p-3 md:p-6 w-full min-w-0">
          <CollegeDashboardContent activeTab={activeTab} />
        </main>
      </div>
    </div>
  );
};

export default CollegeDashboard;