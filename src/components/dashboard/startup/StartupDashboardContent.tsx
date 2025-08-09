import { StartupDashboardOverview } from "./StartupDashboardOverview";
import { StartupPostTaskPage } from "./StartupPostTaskPage";
import { StartupViewTasksPage } from "./StartupViewTasksPage";
import StartupViewApplicationsPage from "./StartupViewApplicationsPage";
import { StartupSubmissionsPage } from "./StartupSubmissionsPage";
import { StartupSettingsPage } from "./StartupSettingsPage";

interface StartupDashboardContentProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function StartupDashboardContent({ activeTab, onTabChange }: StartupDashboardContentProps) {
  switch (activeTab) {
    case "post-task":
      return <StartupPostTaskPage />;
    case "view-tasks":
      return <StartupViewTasksPage onNavigateToPostTask={() => onTabChange("post-task")} />;
    case "applications":
      return <StartupViewApplicationsPage />;
    case "submissions":
      return <StartupSubmissionsPage />;
    case "settings":
      return <StartupSettingsPage />;
    default:
      return <StartupDashboardOverview />;
  }
}