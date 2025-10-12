import { StartupDashboardOverview } from "./StartupDashboardOverview";
import { StartupPostTaskPage } from "./StartupPostTaskPage";
import { StartupViewTasksPage } from "./StartupViewTasksPage";
import StartupViewApplicationsPage from "./StartupViewApplicationsPage";
import { StartupSubmissionsPage } from "./StartupSubmissionsPage";
import { StartupSettingsPage } from "./StartupSettingsPage";
import { StartupJobsPage } from "./StartupJobsPage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface StartupDashboardContentProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isVerified: boolean;
}

const RestrictedAccessMessage = () => (
  <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
    <AlertTitle className="text-amber-900 dark:text-amber-100 font-semibold">
      Verification Required
    </AlertTitle>
    <AlertDescription className="text-amber-800 dark:text-amber-200">
      This feature is available once your startup account is verified by our team.
    </AlertDescription>
  </Alert>
);

export function StartupDashboardContent({ activeTab, onTabChange, isVerified }: StartupDashboardContentProps) {
  const restrictedTabs = ["post-task", "view-tasks", "view-applications", "submissions", "jobs"];
  const isRestrictedTab = restrictedTabs.includes(activeTab);

  if (isRestrictedTab && !isVerified) {
    return <RestrictedAccessMessage />;
  }

  switch (activeTab) {
    case "post-task":
      return <StartupPostTaskPage />;
    case "view-tasks":
      return <StartupViewTasksPage onNavigateToPostTask={() => onTabChange("post-task")} />;
    case "view-applications":
      return <StartupViewApplicationsPage />;
    case "submissions":
      return <StartupSubmissionsPage />;
    case "jobs":
      return <StartupJobsPage />;
    case "settings":
      return <StartupSettingsPage />;
    default:
      return <StartupDashboardOverview />;
  }
}