import { useState } from "react";
import AdminHeader from "@/components/dashboard/admin/AdminHeader";
import AdminSidebar from "@/components/dashboard/admin/AdminSidebar";
import ProofSubmissionsContent from "@/components/dashboard/admin/ProofSubmissionsContent";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";

const ReviewProofs = () => {
  const [activeTab, setActiveTab] = useState("proof-submissions");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const renderContent = () => {
    switch (activeTab) {
      case "proof-submissions":
        return <ProofSubmissionsContent />;
      case "dashboard":
        return <div className="p-6">Dashboard content coming soon...</div>;
      case "manage-jobs":
        return <div className="p-6">Manage Jobs content coming soon...</div>;
      case "manage-resources":
        return <div className="p-6">Manage Resources content coming soon...</div>;
      case "settings":
        return <div className="p-6">Settings content coming soon...</div>;
      default:
        return <ProofSubmissionsContent />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100">
      <AdminHeader 
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
          <AdminSidebar 
            activeTab={activeTab} 
            onTabChange={(tab) => {
              setActiveTab(tab);
              if (isMobile) setSidebarOpen(false);
            }}
          />
        </div>
        
        <main className="flex-1 p-3 md:p-6 w-full min-w-0">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default ReviewProofs;