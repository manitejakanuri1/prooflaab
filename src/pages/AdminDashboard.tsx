import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
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
import AdminAssignTasks from "@/components/dashboard/admin/AdminAssignTasks";
import AdminHeader from "@/components/dashboard/admin/AdminHeader";

const AdminDashboard = () => {
  const { userType } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");

  // Update activeTab based on URL
  useEffect(() => {
    if (location.pathname.includes('/user-management/')) {
      if (userType === 'students') setActiveTab('students');
      else if (userType === 'startups') setActiveTab('startups');
      else if (userType === 'colleges') setActiveTab('colleges');
      else setActiveTab('students'); // default fallback
    } else if (location.pathname === '/admin/dashboard') {
      setActiveTab('dashboard');
    }
  }, [location.pathname, userType]);

  // Handle tab changes and update URL accordingly
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'students' || tab === 'startups' || tab === 'colleges') {
      navigate(`/admin/dashboard/user-management/${tab}`);
    } else if (tab === 'dashboard') {
      navigate('/admin/dashboard');
    }
    // For other tabs, just update the state without navigation
    // as they don't have dedicated URL routes
  };

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
      case "assign-tasks":
        return <AdminAssignTasks />;
      case "jobs":
        return <ContentManagement type="jobs" />;
      case "resources":
        return <ContentManagement type="resources" />;
      case "announcements":
        return <ContentManagement type="announcements" />;
      case "analytics":
        return <AdminAnalytics />;
      case "trust-xp":
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
      <div className="h-screen flex flex-col w-full bg-background overflow-hidden">
        <AdminHeader />
        <div className="flex flex-1 overflow-hidden">
          <AdminSidebar activeTab={activeTab} onTabChange={handleTabChange} />
          <main className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto p-6">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AdminDashboard;