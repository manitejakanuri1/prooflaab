import { useState } from "react";
import CollegeDashboardHeader from "@/components/dashboard/college/CollegeDashboardHeader";
import CollegeDashboardSidebar from "@/components/dashboard/college/CollegeDashboardSidebar";
import CollegeDashboardContent from "@/components/dashboard/college/CollegeDashboardContent";

const CollegeDashboard = () => {
  const [activeTab, setActiveTab] = useState("dashboard");

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
      />
      
      <div className="flex">
        <CollegeDashboardSidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab} 
        />
        
        <main className="flex-1 p-6">
          <CollegeDashboardContent activeTab={activeTab} />
        </main>
      </div>
    </div>
  );
};

export default CollegeDashboard;