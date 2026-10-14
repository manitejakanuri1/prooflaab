import ManageJobsPage from "./ManageJobsPage";
import ManageResourcesPage from "./ManageResourcesPage";
import ManageAnnouncementsPage from "./ManageAnnouncementsPage";

interface ContentManagementProps {
  type: 'jobs' | 'resources' | 'announcements';
}

const ContentManagement = ({ type }: ContentManagementProps) => {
  switch (type) {
    case 'jobs':
      return <ManageJobsPage />;
    case 'resources':
      return <ManageResourcesPage />;
    case 'announcements':
      return <ManageAnnouncementsPage />;
    default:
      return <ManageJobsPage />;
  }
};

export default ContentManagement;