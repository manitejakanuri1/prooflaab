import { useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import AdminSidebar from "@/components/dashboard/admin/AdminSidebar";
import AdminDashboardOverview from "@/components/dashboard/admin/AdminDashboardOverview";
import EnhancedUserManagement from "@/components/dashboard/admin/EnhancedUserManagement";
import TaskOversight from "@/components/dashboard/admin/TaskOversight";
import ContentManagement from "@/components/dashboard/admin/ContentManagement";
import AdminAnalytics from "@/components/dashboard/admin/AdminAnalytics";
import TokenUsage from "@/components/dashboard/admin/TokenUsage";
import SecurityEvents from "@/components/dashboard/admin/SecurityEvents";
import CollegeOversight from "@/components/dashboard/admin/CollegeOversight";
import StudentOversight from "@/components/dashboard/admin/StudentOversight";
import SystemSettings from "@/components/dashboard/admin/SystemSettings";
import AdminAssignTasks from "@/components/dashboard/admin/AdminAssignTasks";
import RecruiterOversight from "@/components/dashboard/admin/RecruiterOversight";
import AdminHeader from "@/components/dashboard/admin/AdminHeader";
import ReviewedSubmissions from "@/components/dashboard/admin/ReviewedSubmissions";
import AdminSubmissions from "@/components/dashboard/admin/AdminSubmissions";
import ContentLibrary from "@/components/dashboard/admin/ContentLibrary";
import StudentTrace from "@/components/dashboard/admin/StudentTrace";
import BugFinder from "@/components/dashboard/admin/BugFinder";
import DailyLots from "@/components/dashboard/admin/DailyLots";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupOf } from "@/components/dashboard/admin/adminNav";
import AdminOpsHealth from "@/components/dashboard/admin/AdminOpsHealth";
import { useUrlTab } from "@/hooks/useUrlTab";

const AdminDashboard = () => {
  const { userType } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  // The page is in the URL (?tab=), so refresh, Back/Forward and pasted links work.
  // /admin/dashboard/user-management/<type> is an older address for the People lists.
  const [tabParam, setTabParam] = useUrlTab("tab", "dashboard");
  const onUserManagement = location.pathname.includes('/user-management/');
  const activeTab = onUserManagement
    ? (['students', 'startups', 'colleges'].includes(userType ?? '') ? userType! : 'students')
    : (tabParam === 'dashboard' ? (location.state as { tab?: string } | null)?.tab ?? tabParam : tabParam);

  const handleTabChange = (tab: string) => {
    if (onUserManagement) navigate(tab === 'dashboard' ? '/admin/dashboard' : `/admin/dashboard?tab=${tab}`);
    else setTabParam(tab);
  };
  const setActiveTab = handleTabChange;

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <AdminDashboardOverview onNavigate={setActiveTab} />;
      case "submissions":
        return <AdminSubmissions />;
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
      case "content-library":
        return <ContentLibrary />;
      case "token-usage":
        return <TokenUsage />;
      case "security-events":
        return <SecurityEvents />;
      case "student-trace":
        return <StudentTrace />;
      case "bug-finder":
        return <BugFinder />;
      case "daily-lots":
        return <DailyLots />;
      case "ops-jobs":
        return <AdminOpsHealth />;
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