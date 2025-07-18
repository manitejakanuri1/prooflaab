import StudentDashboardOverview from "./StudentDashboardOverview";
import StudentTasksPage from "./StudentTasksPage";
import StudentUploadsPage from "./StudentUploadsPage";

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
        return <div className="p-6 bg-white rounded-lg">My Portfolio (Coming Soon)</div>;
      case "progress":
        return <div className="p-6 bg-white rounded-lg">Progress & XP (Coming Soon)</div>;
      case "notifications":
        return <div className="p-6 bg-white rounded-lg">Notifications (Coming Soon)</div>;
      case "settings":
        return <div className="p-6 bg-white rounded-lg">Settings (Coming Soon)</div>;
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