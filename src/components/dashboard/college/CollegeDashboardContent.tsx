import CollegeDashboardOverview from "./CollegeDashboardOverview";
import StudentsManagement from "./StudentsManagement";
import AssignTasks from "./AssignTasks";
import UploadedProofs from "./UploadedProofs";
import TrustScoresSection from "./TrustScoresSection";
import NotificationsSection from "./NotificationsSection";
import CollegeProfilePage from "./CollegeProfilePage";
import CollegeSettingsPage from "./CollegeSettingsPage";
import { RecruiterLinksPage } from "./RecruiterLinksPage";

interface CollegeDashboardContentProps {
  activeTab: string;
  onTabChange?: (tab: string) => void;
}

const CollegeDashboardContent = ({ activeTab, onTabChange }: CollegeDashboardContentProps) => {
  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <CollegeDashboardOverview onNavigate={onTabChange} />;
      case "students":
        return <StudentsManagement />;
      case "assign-tasks":
        return <AssignTasks />;
      case "uploaded-proofs":
        return <UploadedProofs />;
      case "trust-scores":
        return <TrustScoresSection />;
      case "recruiter-links":
        return <RecruiterLinksPage />;
      case "notifications":
        return <NotificationsSection />;
      case "profile":
        return <CollegeProfilePage />;
      case "settings":
        return <CollegeSettingsPage />;
      default:
        return <CollegeDashboardOverview onNavigate={onTabChange} />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {renderContent()}
    </div>
  );
};

export default CollegeDashboardContent;