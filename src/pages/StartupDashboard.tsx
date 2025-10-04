import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { StartupSidebar } from "@/components/dashboard/startup/StartupSidebar";
import { StartupDashboardHeader } from "@/components/dashboard/startup/StartupDashboardHeader";
import { StartupDashboardContent } from "@/components/dashboard/startup/StartupDashboardContent";
import { VerificationBanner } from "@/components/dashboard/startup/VerificationBanner";
import { useStartupVerification } from "@/hooks/useStartupVerification";

const StartupDashboard = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const { data: verificationData } = useStartupVerification();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const isVerified = verificationData?.verification_status === "approved";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <StartupSidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab} 
          isVerified={isVerified}
        />
        
        <div className="flex-1 flex flex-col">
          <StartupDashboardHeader />
          
          <main className="flex-1 p-6">
            {verificationData?.verification_status && (
              <VerificationBanner verificationStatus={verificationData.verification_status} />
            )}
            <StartupDashboardContent 
              activeTab={activeTab} 
              onTabChange={setActiveTab}
              isVerified={isVerified}
            />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default StartupDashboard;