import StudentDashboardOverview from "./StudentDashboardOverview";
import StudentStartupOpportunitiesPage from "./StudentStartupOpportunitiesPage";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import StudentCreatedTasksPage from "./StudentCreatedTasksPage";
import StudentUploadsPage from "./StudentUploadsPage";
import StudentPortfolioPage from "./StudentPortfolioPage";
import StudentProgressPage from "./StudentProgressPage";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentSettingsPage from "./StudentSettingsPage";
import StudentCreateTaskPage from "./StudentCreateTaskPage";
import StudentFeedPage from "./StudentFeedPage";
import ResumeCheckFlow from "./ResumeCheckFlow";
import StudentResumeJobMatchPage from "./StudentResumeJobMatchPage";
import StudentResumeCertsPage from "./StudentResumeCertsPage";
import StudentResumeHistoryPage from "./StudentResumeHistoryPage";
import StudentRoadmapPage from "./StudentRoadmapPage";
import StudentResumeHub from "./StudentResumeHub";
import StudentTasksHub from "./StudentTasksHub";
import StudentUpdatesHub from "./StudentUpdatesHub";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface StudentDashboardContentProps {
  activeTab: string;
  refreshProfile?: () => void;
  onTabChange?: (tab: string) => void;
}

const StudentDashboardContent = ({ activeTab, refreshProfile, onTabChange }: StudentDashboardContentProps) => {
  const renderContent = () => {
    switch (activeTab) {
      case "feed":
        return <StudentFeedPage />;
      case "dashboard":
        return <StudentDashboardOverview onNavigateTab={onTabChange} />;
      case "resume":
        return <ResumeCheckFlow onNavigateTab={onTabChange} />;
      case "resume-jobmatch":
        return <StudentResumeJobMatchPage />;
      case "resume-certs":
        return <StudentResumeCertsPage />;
      case "resume-history":
        return <StudentResumeHistoryPage />;
      case "resume-roadmap":
        return <StudentRoadmapPage />;
      case "resume-hub":
        return <StudentResumeHub />;
      case "tasks-hub":
        return <StudentTasksHub />;
      case "updates-hub":
        return <StudentUpdatesHub />;
      // New task submenu routes
      case "tasks-opportunities":
        return <StudentStartupOpportunitiesPage />;
      case "tasks-assigned":
        return <StudentAssignedTasksPage />;
      case "tasks-created":
        return <StudentCreatedTasksPage />;
      case "create-task":
        return <StudentCreateTaskPage />;
      case "uploads":
        return <StudentUploadsPage />;
      case "portfolio":
        return <StudentPortfolioPage />;
      case "progress":
        return <StudentProgressPage />;
      case "notifications":
        return <StudentNotificationsPage />;
      case "settings":
        return <StudentSettingsPage refreshProfile={refreshProfile} />;
      default:
        return <StudentDashboardOverview onNavigateTab={onTabChange} />;
    }
  };

  return (
    <div className={activeTab === "portfolio" ? "w-full" : "max-w-7xl mx-auto"}>
      {activeTab !== "dashboard" && onTabChange && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onTabChange("dashboard")}
          className="mb-3 gap-1.5 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>
      )}
      {renderContent()}
    </div>
  );
};

export default StudentDashboardContent;