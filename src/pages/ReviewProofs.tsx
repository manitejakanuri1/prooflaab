import { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import AdminSidebar from "@/components/dashboard/admin/AdminSidebar";
import AdminDashboardOverview from "@/components/dashboard/admin/AdminDashboardOverview";
import ProofSubmissionsContent from "@/components/dashboard/admin/ProofSubmissionsContent";
import EnhancedUserManagement from "@/components/dashboard/admin/EnhancedUserManagement";
import TaskOversight from "@/components/dashboard/admin/TaskOversight";
import ContentManagement from "@/components/dashboard/admin/ContentManagement";
import AdminAnalytics from "@/components/dashboard/admin/AdminAnalytics";
import TrustXPModeration from "@/components/dashboard/admin/TrustXPModeration";
import CollegeOversight from "@/components/dashboard/admin/CollegeOversight";
import StartupOversight from "@/components/dashboard/admin/StartupOversight";
import StudentOversight from "@/components/dashboard/admin/StudentOversight";
import SystemSettings from "@/components/dashboard/admin/SystemSettings";

const ReviewProofs = () => {
  const [activeTab, setActiveTab] = useState("dashboard");

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <AdminDashboardOverview onNavigate={setActiveTab} />;
      case "proof-submissions":
        return <ProofSubmissionsContent />;
      case "students":
      case "startups":
      case "colleges":
        return <EnhancedUserManagement initialTab={activeTab} />;
      case "task-oversight":
        return <TaskOversight />;
      case "jobs":
      case "resources":
      case "announcements":
        return <ContentManagement type={activeTab as 'jobs' | 'resources' | 'announcements'} />;
      case "analytics":
        return <AdminAnalytics />;
      case "xp-moderation":
        return <TrustXPModeration />;
      case "college-oversight":
        return <CollegeOversight />;
      case "startup-oversight":
        return <StartupOversight />;
      case "student-oversight":
        return <StudentOversight />;
      case "settings":
        return <SystemSettings />;
      default:
        return <AdminDashboardOverview onNavigate={setActiveTab} />;
    }
  };

  return (
    <SidebarProvider>
      <div className="h-screen flex w-full bg-background overflow-hidden">
        <AdminSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="flex-1 overflow-hidden">
          <div className="h-full p-6">
            {renderContent()}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
};

export default ReviewProofs;