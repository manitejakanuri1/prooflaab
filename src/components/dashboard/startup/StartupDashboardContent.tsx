import { useEffect, useState } from "react";
import { StartupDashboardOverview } from "./StartupDashboardOverview";
import { StartupPostTaskPage } from "./StartupPostTaskPage";
import { StartupViewTasksPage } from "./StartupViewTasksPage";
import StartupViewApplicationsPage from "./StartupViewApplicationsPage";
import { StartupSubmissionsPage } from "./StartupSubmissionsPage";
import { StartupSettingsPage } from "./StartupSettingsPage";
import { StartupJobsPage } from "./StartupJobsPage";
import RecruiterDashboardContent from "../recruiter/RecruiterDashboardContent";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      This feature is available once your company account is verified by our team.
    </AlertDescription>
  </Alert>
);

/**
 * The Company dashboard: what used to be the Startup and the Recruiter
 * dashboards, as four destinations. Every page is the existing one, placed in a
 * tab - nothing was rewritten, so nothing either dashboard did is lost.
 *
 * Old tab ids (from the startup sidebar, or the recruiter's own) still resolve
 * to the destination and tab that now holds them.
 */
const WHERE: Record<string, [string, string]> = {
  dashboard: ["home", ""],
  search: ["talent", "search"], shortlist: ["talent", "shortlist"],
  lots: ["work", "lots"], "post-task": ["work", "post-task"], "view-tasks": ["work", "view-tasks"],
  "view-applications": ["work", "view-applications"], submissions: ["work", "submissions"],
};

export function StartupDashboardContent({ activeTab, onTabChange, isVerified }: StartupDashboardContentProps) {
  const [dest, sub] = WHERE[activeTab] ?? [activeTab, ""];
  const [talentTab, setTalentTab] = useState("search");
  const [workTab, setWorkTab] = useState("post-task");

  useEffect(() => {
    if (dest === "talent" && sub) setTalentTab(sub);
    if (dest === "work" && sub) setWorkTab(sub);
    if (sub) onTabChange(dest);
  }, [dest, sub, onTabChange]);

  // The recruiter screens link to "talent" and "shortlist" by their old names.
  const fromRecruiter = (tab: string) => onTabChange(tab === "talent" ? "search" : tab);

  if ((dest === "work" || dest === "jobs") && !isVerified) return <RestrictedAccessMessage />;

  switch (dest) {
    case "talent":
      return (
        <Tabs value={talentTab} onValueChange={setTalentTab}>
          <TabsList>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="shortlist">Shortlist</TabsTrigger>
          </TabsList>
          <TabsContent value="search" className="mt-4">
            <RecruiterDashboardContent activeTab="talent" onTabChange={fromRecruiter} />
          </TabsContent>
          <TabsContent value="shortlist" className="mt-4">
            <RecruiterDashboardContent activeTab="shortlist" onTabChange={fromRecruiter} />
          </TabsContent>
        </Tabs>
      );
    case "work":
      return (
        <Tabs value={workTab} onValueChange={setWorkTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="post-task">Post Task</TabsTrigger>
            <TabsTrigger value="view-tasks">My Tasks</TabsTrigger>
            <TabsTrigger value="view-applications">Applications</TabsTrigger>
            <TabsTrigger value="submissions">Submissions</TabsTrigger>
            <TabsTrigger value="lots">Sponsored Lots</TabsTrigger>
          </TabsList>
          <TabsContent value="post-task" className="mt-4">
            <StartupPostTaskPage onNavigateToApplications={() => setWorkTab("view-applications")} />
          </TabsContent>
          <TabsContent value="view-tasks" className="mt-4">
            <StartupViewTasksPage onNavigateToPostTask={() => setWorkTab("post-task")} />
          </TabsContent>
          <TabsContent value="view-applications" className="mt-4">
            <StartupViewApplicationsPage />
          </TabsContent>
          <TabsContent value="submissions" className="mt-4">
            <StartupSubmissionsPage />
          </TabsContent>
          <TabsContent value="lots" className="mt-4">
            <RecruiterDashboardContent activeTab="lots" onTabChange={fromRecruiter} />
          </TabsContent>
        </Tabs>
      );
    case "jobs":
      return <StartupJobsPage />;
    case "settings":
      return <StartupSettingsPage />;
    default:
      return (
        <div className="space-y-6">
          <StartupDashboardOverview />
          <RecruiterDashboardContent activeTab="home" onTabChange={fromRecruiter} />
        </div>
      );
  }
}
