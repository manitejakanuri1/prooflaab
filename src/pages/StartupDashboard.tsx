import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { StartupSidebar } from "@/components/dashboard/startup/StartupSidebar";
import { StartupDashboardHeader } from "@/components/dashboard/startup/StartupDashboardHeader";
import { StartupDashboardContent } from "@/components/dashboard/startup/StartupDashboardContent";

const StartupDashboard = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");

  // Temporarily bypassing authentication for debugging
  // if (loading) {
  //   return (
  //     <div className="flex items-center justify-center min-h-screen">
  //       <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  //     </div>
  //   );
  // }

  // if (!user) {
  //   return <Navigate to="/auth" replace />;
  // }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <StartupSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        
        <div className="flex-1 flex flex-col">
          <StartupDashboardHeader />
          
          <main className="flex-1 p-6">
            <StartupDashboardContent activeTab={activeTab} onTabChange={setActiveTab} />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default StartupDashboard;