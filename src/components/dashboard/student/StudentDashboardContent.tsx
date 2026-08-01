import StudentDashboardOverview from "./StudentDashboardOverview";
import StudentStartupOpportunitiesPage from "./StudentStartupOpportunitiesPage";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import StudentCreatedTasksPage from "./StudentCreatedTasksPage";
import StudentApplicationsPage from "./StudentApplicationsPage";
import StudentUploadsPage from "./StudentUploadsPage";
import StudentPortfolioPage from "./StudentPortfolioPage";
import StudentProgressPage from "./StudentProgressPage";
import StudentLearningResourcesPage from "./StudentLearningResourcesPage";
import StudentJobOpportunitiesPage from "./StudentJobOpportunitiesPage";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentSettingsPage from "./StudentSettingsPage";
import StudentCreateTaskPage from "./StudentCreateTaskPage";
import StudentFeedPage from "./StudentFeedPage";
import StudentResumeCheckPage from "./StudentResumeCheckPage";
import StudentResumeJobMatchPage from "./StudentResumeJobMatchPage";
import StudentResumeCertsPage from "./StudentResumeCertsPage";
import StudentResumeHistoryPage from "./StudentResumeHistoryPage";
import StudentRoadmapPage from "./StudentRoadmapPage";

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
        return <StudentResumeCheckPage onNavigateTab={onTabChange} />;
      case "resume-jobmatch":
        return <StudentResumeJobMatchPage />;
      case "resume-certs":
        return <StudentResumeCertsPage />;
      case "resume-history":
        return <StudentResumeHistoryPage />;
      case "resume-roadmap":
        return <StudentRoadmapPage />;
      // New task submenu routes
      case "tasks-opportunities":
        return <StudentStartupOpportunitiesPage />;
      case "tasks-assigned":
        return <StudentAssignedTasksPage />;
      case "tasks-created":
        return <StudentCreatedTasksPage />;
      case "create-task":
        return <StudentCreateTaskPage />;
      case "applications":
        return <StudentApplicationsPage />;
      case "uploads":
        return <StudentUploadsPage />;
      case "portfolio":
        return <StudentPortfolioPage />;
      case "progress":
        return <StudentProgressPage />;
      case "learning":
        return <StudentLearningResourcesPage />;
      case "jobs":
        return <StudentJobOpportunitiesPage />;
      case "notifications":
        return <StudentNotificationsPage />;
      case "settings":
        return <StudentSettingsPage refreshProfile={refreshProfile} />;
      default:
        return <StudentFeedPage />;
    }
  };

  return (
    <div className={activeTab === "portfolio" ? "w-full" : "max-w-7xl mx-auto"}>
      {renderContent()}
    </div>
  );
};

export default StudentDashboardContent;