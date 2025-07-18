import StudentDashboardOverview from "./StudentDashboardOverview";
import StudentTasksPage from "./StudentTasksPage";
import StudentUploadsPage from "./StudentUploadsPage";
import StudentPortfolioPage from "./StudentPortfolioPage";
import StudentProgressPage from "./StudentProgressPage";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentSettingsPage from "./StudentSettingsPage";

interface StudentDashboardContentProps {
  activeTab: string;
}

const StudentDashboardContent = ({ activeTab }: StudentDashboardContentProps) => {
  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <StudentDashboardOverview />;
      case "tasks":
        return <StudentTasksPage />;
      case "uploads":
        return <StudentUploadsPage />;
      case "portfolio":
        return <StudentPortfolioPage />;
      case "progress":
        return <StudentProgressPage />;
      case "notifications":
        return <StudentNotificationsPage />;
      case "settings":
        return <StudentSettingsPage />;
      default:
        return <StudentDashboardOverview />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {renderContent()}
    </div>
  );
};

export default StudentDashboardContent;