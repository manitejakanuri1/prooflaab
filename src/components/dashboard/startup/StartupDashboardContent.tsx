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
 * The Company dashboard. Recruiter = Company (owner's decision, locked 3 Oct
 * 2026): one role, one organisation, six destinations - Home, Talent, Shortlist,
 * Lots, Submissions, Review - with Jobs and Settings as account chrome.
 *
 * Every Lot, posted or sponsored, is graded like any other student work and its
 * result is read from task_submissions (migration 54), so Lots, Submissions and
 * Review all show the same evidence the student's Build-log shows.
 *
 * Old tab ids (startup and recruiter bookmarks) still resolve.
 */
const WHERE: Record<string, [string, string]> = {
  dashboard: ["home", ""], work: ["lots", ""],
  search: ["talent", ""],
  "post-task": ["lots", "post-task"], "view-tasks": ["lots", "view-tasks"],
  "view-applications": ["review", "applications"],
};

const NEEDS_VERIFICATION = new Set(["lots", "submissions", "review", "jobs"]);

export function StartupDashboardContent({ activeTab, onTabChange, isVerified }: StartupDashboardContentProps) {
  const [dest, sub] = WHERE[activeTab] ?? [activeTab, ""];
  const [lotsTab, setLotsTab] = useState("sponsored");
  const [reviewTab, setReviewTab] = useState("work");

  useEffect(() => {
    if (dest === "lots" && sub) setLotsTab(sub);
    if (dest === "review" && sub) setReviewTab(sub);
    if (sub || WHERE[activeTab]) onTabChange(dest);
  }, [dest, sub, activeTab, onTabChange]);

  // The recruiter screens link to their sections by their own names.
  const fromRecruiter = (tab: string) => onTabChange(tab === "lots" ? "lots" : tab);

  if (NEEDS_VERIFICATION.has(dest) && !isVerified) return <RestrictedAccessMessage />;

  switch (dest) {
    case "talent":
      return <RecruiterDashboardContent activeTab="talent" onTabChange={fromRecruiter} />;
    case "shortlist":
      return <RecruiterDashboardContent activeTab="shortlist" onTabChange={fromRecruiter} />;
    case "lots":
      return (
        <Tabs value={lotsTab} onValueChange={setLotsTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="sponsored">Sponsored Lots</TabsTrigger>
            <TabsTrigger value="post-task">Post a task</TabsTrigger>
            <TabsTrigger value="view-tasks">Your posted tasks</TabsTrigger>
          </TabsList>
          <TabsContent value="sponsored" className="mt-4">
            <RecruiterDashboardContent activeTab="lots" onTabChange={fromRecruiter} />
          </TabsContent>
          <TabsContent value="post-task" className="mt-4">
            <StartupPostTaskPage onNavigateToApplications={() => { setReviewTab("applications"); onTabChange("review"); }} />
          </TabsContent>
          <TabsContent value="view-tasks" className="mt-4">
            <StartupViewTasksPage onNavigateToPostTask={() => setLotsTab("post-task")} />
          </TabsContent>
        </Tabs>
      );
    case "submissions":
      return <StartupSubmissionsPage />;
    case "review":
      return (
        <Tabs value={reviewTab} onValueChange={setReviewTab}>
          <TabsList>
            <TabsTrigger value="work">Work to review</TabsTrigger>
            <TabsTrigger value="applications">Applications</TabsTrigger>
          </TabsList>
          <TabsContent value="work" className="mt-4">
            <StartupSubmissionsPage initialFilter="unreviewed" />
          </TabsContent>
          <TabsContent value="applications" className="mt-4">
            <StartupViewApplicationsPage />
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
          <StartupDashboardOverview onEditProfile={() => onTabChange("settings")} />
          <RecruiterDashboardContent activeTab="home" onTabChange={fromRecruiter} />
        </div>
      );
  }
}
