import StudentDashboardOverview from "./StudentDashboardOverview";
import StudentUnifiedTasksPage from "./StudentUnifiedTasksPage";
import StudentApplicationsPage from "./StudentApplicationsPage";
import StudentUploadsPage from "./StudentUploadsPage";
import StudentPortfolioPage from "./StudentPortfolioPage";
import StudentProgressPage from "./StudentProgressPage";
import StudentLearningResourcesPage from "./StudentLearningResourcesPage";
import StudentJobOpportunitiesPage from "./StudentJobOpportunitiesPage";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentSettingsPage from "./StudentSettingsPage";

interface StudentDashboardContentProps {
  activeTab: string;
  refreshProfile?: () => void;
}

const StudentDashboardContent = ({ activeTab, refreshProfile }: StudentDashboardContentProps) => {
  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <StudentDashboardOverview />;
      case "tasks":
        return <StudentUnifiedTasksPage />;
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
        return <StudentDashboardOverview />;
    }
  };

  return (
    <div className={activeTab === "portfolio" ? "w-full" : "max-w-7xl mx-auto"}>
      {renderContent()}
    </div>
  );
};

export default StudentDashboardContent;