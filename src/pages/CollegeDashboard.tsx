import { useState } from "react";
import CollegeDashboardHeader from "@/components/dashboard/college/CollegeDashboardHeader";
import CollegeDashboardSidebar from "@/components/dashboard/college/CollegeDashboardSidebar";
import CollegeDashboardContent from "@/components/dashboard/college/CollegeDashboardContent";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";

const CollegeDashboard = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const collegeData = {
    name: "Indian Institute of Technology",
    email: "admin@iit.edu",
    profilePhoto: null,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
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