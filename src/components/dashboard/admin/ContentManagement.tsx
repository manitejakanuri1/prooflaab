import ManageJobsPage from "./ManageJobsPage";
import ManageResourcesPage from "./ManageResourcesPage";
import ManageAnnouncementsPage from "./ManageAnnouncementsPage";
import AddMaterial from "./AddMaterial";

interface ContentManagementProps {
  type: 'jobs' | 'resources' | 'announcements';
}

const ContentManagement = ({ type }: ContentManagementProps) => {
  switch (type) {
    case 'jobs':
      return <ManageJobsPage />;
    case 'resources':
      return (
        <div className="space-y-6">
          <AddMaterial />
          <ManageResourcesPage />
        </div>
      );
    case 'announcements':
      return <ManageAnnouncementsPage />;
    default:
      return <ManageJobsPage />;
  }
};

export default ContentManagement;