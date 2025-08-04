import { StartupDashboardOverview } from "./StartupDashboardOverview";
import { StartupPostTaskPage } from "./StartupPostTaskPage";
import { StartupViewTasksPage } from "./StartupViewTasksPage";
import { StartupSubmissionsPage } from "./StartupSubmissionsPage";
import { StartupSettingsPage } from "./StartupSettingsPage";

interface StartupDashboardContentProps {
  activeTab: string;
}

export function StartupDashboardContent({ activeTab }: StartupDashboardContentProps) {
  switch (activeTab) {
    case "post-task":
      return <StartupPostTaskPage />;
    case "view-tasks":
      return <StartupViewTasksPage />;
    case "submissions":
      return <StartupSubmissionsPage />;
    case "settings":
      return <StartupSettingsPage />;
    default:
      return <StartupDashboardOverview />;
  }
}