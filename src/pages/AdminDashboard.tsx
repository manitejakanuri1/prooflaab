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
import TokenUsage from "@/components/dashboard/admin/TokenUsage";
import SecurityEvents from "@/components/dashboard/admin/SecurityEvents";
import TrustXPModeration from "@/components/dashboard/admin/TrustXPModeration";
import CollegeOversight from "@/components/dashboard/admin/CollegeOversight";
import StudentOversight from "@/components/dashboard/admin/StudentOversight";
import SystemSettings from "@/components/dashboard/admin/SystemSettings";
import AdminAssignTasks from "@/components/dashboard/admin/AdminAssignTasks";
import RecruiterOversight from "@/components/dashboard/admin/RecruiterOversight";
import AdminHeader from "@/components/dashboard/admin/AdminHeader";
import ReviewedSubmissions from "@/components/dashboard/admin/ReviewedSubmissions";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupOf } from "@/components/dashboard/admin/adminNav";

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

    if (path.includes('/user-management/')) {
      if (userType === 'students') setActiveTab('students');
      else if (userType === 'startups') setActiveTab('startups');
      else if (userType === 'colleges') setActiveTab('colleges');
      else setActiveTab('students');
    } else if (path === '/admin/dashboard') {
      // A page reached by leaving /user-management/ carries its tab in state;
      // without it every such click snapped back to Dashboard.
      setActiveTab((location.state as { tab?: string } | null)?.tab ?? 'dashboard');
    }
  }, [location.pathname, location.state, userType]);

  // Handle tab changes and update URL accordingly
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'students' || tab === 'startups' || tab === 'colleges') {
      navigate(`/admin/dashboard/user-management/${tab}`);
    } else if (location.pathname !== '/admin/dashboard') {
      navigate('/admin/dashboard', { state: { tab } });
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
      case "reviewed-submissions":
        return <ReviewedSubmissions />;
      case "students":
      case "colleges":
        return <EnhancedUserManagement initialTab={activeTab} hideTabList />;
      // Companies = the old Startups list plus the old Recruiters screen: one
      // company now carries both, and approving it approves both halves.
      case "startups":
      case "recruiter-oversight":
        return (
          <div className="space-y-6">
            <EnhancedUserManagement initialTab="startups" hideTabList />
            <RecruiterOversight />
          </div>
        );
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
      case "token-usage":
        return <TokenUsage />;
      case "security-events":
        return <SecurityEvents />;
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
            <div className="p-3 md:p-4 lg:p-6 space-y-4">
              {/* The pages of the current destination, as tabs. */}
              {(() => {
                const group = groupOf(activeTab);
                if (!group || group.children.length < 2) return null;
                const current = activeTab === "recruiter-oversight" ? "startups" : activeTab;
                return (
                  <Tabs value={current} onValueChange={handleTabChange}>
                    <TabsList className="flex-wrap h-auto">
                      {group.children.map((c) => (
                        <TabsTrigger key={c.id} value={c.id}>{c.label}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                );
              })()}
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AdminDashboard;