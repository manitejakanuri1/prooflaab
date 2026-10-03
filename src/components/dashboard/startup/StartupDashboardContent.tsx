import { useEffect } from "react";
import { StartupSubmissionsPage } from "./StartupSubmissionsPage";
import { StartupSettingsPage } from "./StartupSettingsPage";
import { StartupJobsPage } from "./StartupJobsPage";
import RecruiterDashboardContent from "../recruiter/RecruiterDashboardContent";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useUrlTab } from "@/hooks/useUrlTab";

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
 * The Company dashboard: four destinations - Home, Talent, Lots, Hiring.
 *
 *   Lots    My Lots · Create a Lot · Submissions · Reviews
 *   Hiring  Shortlist (the candidate pipeline) · Job posts
 *
 * Every Lot is graded like any other student work; results are read from
 * task_submissions and the explanation bound to that submission. Settings is
 * account chrome (header), not a destination.
 *
 * REDIRECTS holds no logic: an old tab id (a bookmark, a link from an older
 * build) is rewritten to its new destination and inner view, nothing more.
 */
export const COMPANY_REDIRECTS: Record<string, [string, string]> = {
  shortlist: ["hiring", "shortlist"],
  jobs: ["hiring", "jobs"],
  submissions: ["lots", "submissions"],
  review: ["lots", "reviews"],
  dashboard: ["home", ""], search: ["talent", ""], work: ["lots", ""],
  "post-task": ["lots", "create"], "view-tasks": ["lots", ""], "view-applications": ["lots", "reviews"],
};

const NEEDS_VERIFICATION = new Set(["lots", "hiring"]);
const LOT_VIEWS = [["active", "My Lots"], ["create", "Create a Lot"], ["submissions", "Submissions"], ["reviews", "Reviews"]];
const HIRING_VIEWS = [["shortlist", "Shortlist"], ["jobs", "Job posts"]];

export function StartupDashboardContent({ activeTab, onTabChange, isVerified }: StartupDashboardContentProps) {
  const [view, setView] = useUrlTab("view", "");
  const [, setParams] = useSearchParams();
  const redirect = COMPANY_REDIRECTS[activeTab];

  // Destination and inner view change in ONE navigation (two separate updates would
  // overwrite each other). `replace` keeps a redirect out of the Back history.
  const open = (tab: string, replace = false) => {
    const [dest, inner] = COMPANY_REDIRECTS[tab] ?? [tab, ""];
    setParams({ ...(dest !== "home" ? { tab: dest } : {}), ...(inner ? { view: inner } : {}) }, { replace });
  };

  useEffect(() => {
    if (redirect) open(activeTab, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // The recruiter screens link to their sections by their own names.
  const go = (tab: string) => open(tab);

  if (redirect) return null;
  if (NEEDS_VERIFICATION.has(activeTab) && !isVerified) return <RestrictedAccessMessage />;

  const inner = (views: string[][], current: string) => (
    <Tabs value={current} onValueChange={setView} className="mb-4">
      <TabsList className="flex-wrap h-auto">
        {views.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );

  switch (activeTab) {
    case "talent":
      return <RecruiterDashboardContent activeTab="talent" onTabChange={go} />;

    case "lots": {
      const v = LOT_VIEWS.some(([id]) => id === view) ? view : "active";
      return (
        <div>
          {inner(LOT_VIEWS, v)}
          {v === "active" && <RecruiterDashboardContent activeTab="lots" onTabChange={go} />}
          {v === "create" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground max-w-prose">
                A Lot is set for a candidate you have shortlisted. Choose one below and press
                "Set a task": a coding Lot gets real tests, a written Lot gets its own checklist.
              </p>
              <RecruiterDashboardContent activeTab="shortlist" onTabChange={go} />
            </div>
          )}
          {v === "submissions" && <StartupSubmissionsPage />}
          {v === "reviews" && <StartupSubmissionsPage initialFilter="unreviewed" />}
        </div>
      );
    }

    case "hiring": {
      const v = HIRING_VIEWS.some(([id]) => id === view) ? view : "shortlist";
      return (
        <div>
          {inner(HIRING_VIEWS, v)}
          {v === "shortlist" && <RecruiterDashboardContent activeTab="shortlist" onTabChange={go} />}
          {v === "jobs" && <StartupJobsPage />}
        </div>
      );
    }

    case "settings":
      return <StartupSettingsPage />;

    default:
      return <RecruiterDashboardContent activeTab="home" onTabChange={go} />;
  }
}
