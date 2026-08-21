import { useState } from "react";

import TpoHome from "./TpoHome";
import TpoStudents from "./TpoStudents";
import TpoSquads from "./TpoSquads";
import TpoInsights from "./TpoInsights";

import NotificationsSection from "./NotificationsSection";
import CollegeProfilePage from "./CollegeProfilePage";
import CollegeSettingsPage from "./CollegeSettingsPage";

interface CollegeDashboardContentProps {
  activeTab: string;
  onTabChange?: (tab: string) => void;
}

/**
 * Four destinations, and only four.
 *
 * Each one is a whole screen rather than a shelf with the old modules parked on
 * it. Import is an action inside Students, reports are an action inside
 * Insights, and the reserve pool is a filter — exactly as the specification
 * describes them, and none of them a tab of their own.
 *
 * Old tab ids still resolve so an existing link does not break.
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

  // A squad chosen on another screen. Squads reads it, lands on Members, and
  // clears nothing — clicking "Titans" anywhere means "show me who is in Titans".
  const [focusSquad, setFocusSquad] = useState<string | null>(null);
  // "Show me the four who need SQL" — set by a skill gap on Insights.
  const [focusSkill, setFocusSkill] = useState<string | undefined>();

  const goFiltered = (reasonCode: string) => {
    setStudentFilter(reasonCode);
    onTabChange?.("students");
  };

  const goSquad = (squadId: string) => {
    setFocusSquad(squadId);
    onTabChange?.("squads");
  };

  const goSkill = (skill: string) => {
    setFocusSkill(skill);
    setStudentFilter(undefined);
    onTabChange?.("students");
  };

  const render = () => {
    switch (tab) {
      case "home":
        return <TpoHome onNavigate={onTabChange} onFilterStudents={goFiltered} onOpenSquad={goSquad} />;

      case "students":
        return <TpoStudents initialFilter={studentFilter} initialSkill={focusSkill} onOpenSquad={goSquad} />;

      case "squads":
        return <TpoSquads focusSquad={focusSquad} />;

      case "insights":
        return (
          <TpoInsights
            onFilterStudents={goFiltered}
            onFilterSkill={goSkill}
            onOpenSquad={goSquad}
            onNavigate={onTabChange}
          />
        );

      // Account chrome, not destinations — reachable from the sidebar footer.
      case "notifications": return <NotificationsSection />;
      case "profile":       return <CollegeProfilePage />;
      case "settings":      return <CollegeSettingsPage />;

      default:
        return <TpoHome onNavigate={onTabChange} onFilterStudents={goFiltered} onOpenSquad={goSquad} />;
    }
  };

  return <div className="max-w-7xl mx-auto">{render()}</div>;
};

export default CollegeDashboardContent;
