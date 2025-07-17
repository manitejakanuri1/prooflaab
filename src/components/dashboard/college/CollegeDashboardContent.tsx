import CollegeDashboardOverview from "./CollegeDashboardOverview";
import StudentsManagement from "./StudentsManagement";
import AssignTasks from "./AssignTasks";
import UploadedProofs from "./UploadedProofs";

interface CollegeDashboardContentProps {
  activeTab: string;
}

const CollegeDashboardContent = ({ activeTab }: CollegeDashboardContentProps) => {
  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <CollegeDashboardOverview />;
      case "students":
        return <StudentsManagement />;
      case "assign-tasks":
        return <AssignTasks />;
      case "uploaded-proofs":
        return <UploadedProofs />;
      case "trust-scores":
        return <div className="p-6 bg-white rounded-lg">Trust Scores (Coming Soon)</div>;
      case "notifications":
        return <div className="p-6 bg-white rounded-lg">Notifications (Coming Soon)</div>;
      default:
        return <CollegeDashboardOverview />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {renderContent()}
    </div>
  );
};

export default CollegeDashboardContent;