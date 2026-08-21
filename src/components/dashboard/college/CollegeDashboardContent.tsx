import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import TpoHome from "./TpoHome";
import TpoStudents from "./TpoStudents";
import TpoSquads from "./TpoSquads";
import TpoInsights from "./TpoInsights";

import StudentsManagement from "./StudentsManagement";
import AssignTasks from "./AssignTasks";
import UploadedProofs from "./UploadedProofs";
import TrustScoresSection from "./TrustScoresSection";
import NotificationsSection from "./NotificationsSection";
import CollegeProfilePage from "./CollegeProfilePage";
import CollegeSettingsPage from "./CollegeSettingsPage";
import { RecruiterLinksPage } from "./RecruiterLinksPage";
import VerificationTrendsPage from "./VerificationTrendsPage";
import VerificationSettingsPage from "./VerificationSettingsPage";

interface CollegeDashboardContentProps {
  activeTab: string;
  onTabChange?: (tab: string) => void;
}

/**
 * Four destinations, not eleven.
 *
 * Nothing was deleted. Assign Tasks, Uploaded Proofs, Trust Scores, Verification
 * Trends and Settings, and Recruiter Links all still exist — they moved inside
 * the destination they belong to, as tabs. The specification is explicit that
 * import, onboarding, reserve, leaderboard, season, at-risk and reports are
 * capabilities within four places rather than eleven entries in a menu.
 *
 * Old tab ids still resolve, so a bookmark or an old link does not break.
 */
const LEGACY: Record<string, string> = {
  dashboard: "home",
  "assign-tasks": "students",
  "uploaded-proofs": "students",
  "trust-scores": "students",
  "verification-trends": "insights",
  "verification-settings": "insights",
  "recruiter-links": "insights",
};

const CollegeDashboardContent = ({ activeTab, onTabChange }: CollegeDashboardContentProps) => {
  const tab = LEGACY[activeTab] ?? activeTab;

  // Set when a "needs attention" line on Home or Insights is tapped, so Students
  // opens already filtered. §2: "The TPO does not have to search again."
  const [studentFilter, setStudentFilter] = useState<string | undefined>();

  const goFiltered = (reasonCode: string) => {
    setStudentFilter(reasonCode);
    onTabChange?.("students");
  };

  const render = () => {
    switch (tab) {
      case "home":
        return <TpoHome onNavigate={onTabChange} onFilterStudents={goFiltered} />;

      case "students":
        return (
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">Students</TabsTrigger>
              <TabsTrigger value="import">Import &amp; manage</TabsTrigger>
              <TabsTrigger value="assign">Assign tasks</TabsTrigger>
              <TabsTrigger value="proofs">Uploaded proofs</TabsTrigger>
              <TabsTrigger value="trust">Trust scores</TabsTrigger>
            </TabsList>
            <TabsContent value="list" className="mt-4">
              <TpoStudents initialFilter={studentFilter} />
            </TabsContent>
            <TabsContent value="import" className="mt-4"><StudentsManagement /></TabsContent>
            <TabsContent value="assign" className="mt-4"><AssignTasks /></TabsContent>
            <TabsContent value="proofs" className="mt-4"><UploadedProofs /></TabsContent>
            <TabsContent value="trust" className="mt-4"><TrustScoresSection /></TabsContent>
          </Tabs>
        );

      case "squads":
        return <TpoSquads />;

      case "insights":
        return (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Insights</TabsTrigger>
              <TabsTrigger value="trends">Verification trends</TabsTrigger>
              <TabsTrigger value="rules">Verification settings</TabsTrigger>
              <TabsTrigger value="recruiters">Recruiter links</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <TpoInsights onFilterStudents={goFiltered} />
            </TabsContent>
            <TabsContent value="trends" className="mt-4"><VerificationTrendsPage /></TabsContent>
            <TabsContent value="rules" className="mt-4"><VerificationSettingsPage /></TabsContent>
            <TabsContent value="recruiters" className="mt-4"><RecruiterLinksPage /></TabsContent>
          </Tabs>
        );

      // Account chrome, not destinations — reachable from the sidebar footer.
      case "notifications": return <NotificationsSection />;
      case "profile":       return <CollegeProfilePage />;
      case "settings":      return <CollegeSettingsPage />;

      default:
        return <TpoHome onNavigate={onTabChange} onFilterStudents={goFiltered} />;
    }
  };

  return <div className="max-w-7xl mx-auto">{render()}</div>;
};

export default CollegeDashboardContent;
