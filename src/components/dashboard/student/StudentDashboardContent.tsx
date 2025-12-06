import StudentDashboardOverview from "./StudentDashboardOverview";
import StudentStartupOpportunitiesPage from "./StudentStartupOpportunitiesPage";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import StudentCreatedTasksPage from "./StudentCreatedTasksPage";
import StudentTaskPacksPage from "./StudentTaskPacksPage";
import StudentTaskPackDetailPage from "./StudentTaskPackDetailPage";
import StudentTaskPackTaskPage from "./StudentTaskPackTaskPage";
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

interface StudentDashboardContentProps {
  activeTab: string;
  refreshProfile?: () => void;
}

const StudentDashboardContent = ({ activeTab, refreshProfile }: StudentDashboardContentProps) => {
  const renderContent = () => {
    switch (activeTab) {
      case "feed":
        return <StudentFeedPage />;
      case "dashboard":
        return <StudentDashboardOverview />;
      // New task submenu routes
      case "tasks-opportunities":
        return <StudentStartupOpportunitiesPage />;
      case "tasks-assigned":
        return <StudentAssignedTasksPage />;
      case "tasks-created":
        return <StudentCreatedTasksPage />;
      case "task-packs":
        return <StudentTaskPacksPage />;
      case "task-pack-detail":
        return <StudentTaskPackDetailPage />;
      case "task-pack-task":
        return <StudentTaskPackTaskPage />;
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