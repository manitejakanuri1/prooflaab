import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import AdminSidebar from "@/components/dashboard/admin/AdminSidebar";
import AdminDashboardOverview from "@/components/dashboard/admin/AdminDashboardOverview";
import ProofSubmissionsContent from "@/components/dashboard/admin/ProofSubmissionsContent";
import EnhancedUserManagement from "@/components/dashboard/admin/EnhancedUserManagement";
import TaskOversight from "@/components/dashboard/admin/TaskOversight";
import ContentManagement from "@/components/dashboard/admin/ContentManagement";
import AdminAnalytics from "@/components/dashboard/admin/AdminAnalytics";
import TrustXPModeration from "@/components/dashboard/admin/TrustXPModeration";
import CollegeOversight from "@/components/dashboard/admin/CollegeOversight";
import StudentOversight from "@/components/dashboard/admin/StudentOversight";
import SystemSettings from "@/components/dashboard/admin/SystemSettings";
import AdminAssignTasks from "@/components/dashboard/admin/AdminAssignTasks";
import AdminHeader from "@/components/dashboard/admin/AdminHeader";
import AdminTaskPacksPage from "@/components/dashboard/admin/AdminTaskPacksPage";
import AdminTaskPackCreatePage from "@/components/dashboard/admin/AdminTaskPackCreatePage";
import AdminTaskPackEditPage from "@/components/dashboard/admin/AdminTaskPackEditPage";

const AdminDashboard = () => {
  const { userType, packId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  // Update activeTab based on URL
  useEffect(() => {
    const path = location.pathname;
    
    if (path.includes('/admin/task-packs')) {
      setActiveTab('task-packs');
    } else if (path.includes('/user-management/')) {
      if (userType === 'students') setActiveTab('students');
      else if (userType === 'startups') setActiveTab('startups');
      else if (userType === 'colleges') setActiveTab('colleges');
      else setActiveTab('students');
    } else if (path === '/admin/dashboard') {
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
    const path = location.pathname;
    
    // Handle task-packs routes
    if (path === '/admin/task-packs') {
      return <AdminTaskPacksPage />;
    }
    if (path === '/admin/task-packs/create') {
      return <AdminTaskPackCreatePage />;
    }
    if (path.match(/\/admin\/task-packs\/[^/]+\/edit$/)) {
      return <AdminTaskPackEditPage />;
    }
    if (path.match(/\/admin\/task-packs\/[^/]+$/)) {
      // View tasks in pack - placeholder for now
      return <AdminTaskPacksPage />;
    }
    
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
      case "task-packs":
        return <AdminTaskPacksPage />;
      case "jobs":
        return <ContentManagement type="jobs" />;
      case "resources":
        return <ContentManagement type="resources" />;
      case "announcements":
        return <ContentManagement type="announcements" />;
      case "analytics":
        return <AdminAnalytics />;
      case "xp-moderation":
        return <TrustXPModeration />;
      case "college-oversight":
        return <CollegeOversight />;
      case "student-oversight":
        return <StudentOversight />;
      case "settings":
        return <SystemSettings />;
      default:
        return <AdminDashboardOverview onNavigate={setActiveTab} />;
    }
  };

  return (
    <SidebarProvider 
      open={!isMobile || sidebarOpen}
      onOpenChange={setSidebarOpen}
    >
      <div className="min-h-screen flex w-full bg-background relative">
        {/* Mobile overlay */}
        {isMobile && sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        
        <AdminSidebar 
          activeTab={activeTab} 
          onTabChange={(tab) => {
            handleTabChange(tab);
            if (isMobile) setSidebarOpen(false);
          }} 
        />
        
        <div className="flex-1 flex flex-col min-w-0">
          <AdminHeader />
          <main className="flex-1 overflow-auto">
            <div className="p-3 md:p-4 lg:p-6">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AdminDashboard;