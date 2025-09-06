import CollegeDashboardOverview from "./CollegeDashboardOverview";
import StudentsManagement from "./StudentsManagement";
import AssignTasks from "./AssignTasks";
import UploadedProofs from "./UploadedProofs";
import TrustScoresSection from "./TrustScoresSection";
import NotificationsSection from "./NotificationsSection";

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
        return <TrustScoresSection />;
      case "notifications":
        return <NotificationsSection />;
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