import { useEffect, useRef, useState } from "react";

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

  /**
   * What the last click asked Students to show.
   *
   * One object rather than two independent pieces of state, because they were
   * being set independently and left each other behind: opening a skill gap and
   * then tapping "needs attention" showed the students who were BOTH, which is
   * neither of the two things that were asked for.
   *
   * The counter matters as much as the values. Without it, tapping the same card
   * twice sends the same props, React sees no change, and nothing happens — so
   * a filter the officer had cleared by hand could not be re-applied by tapping
   * the card that set it.
   */
  const [intent, setIntent] = useState<{ filter?: string; skill?: string; n: number }>({ n: 0 });
  const [focusSquad, setFocusSquad] = useState<{ id: string; n: number } | null>(null);

  // True only for the instant between a card being tapped and the tab changing,
  // so arriving at Students from the sidebar can be told apart from arriving
  // from a card — the sidebar means "show me everyone".
  const deliberate = useRef(false);

  const goStudents = (next: { filter?: string; skill?: string }) => {
    deliberate.current = true;
    setIntent((i) => ({ filter: next.filter, skill: next.skill, n: i.n + 1 }));
    onTabChange?.("students");
  };

  const goFiltered = (reasonCode: string) => goStudents({ filter: reasonCode });
  const goSkill    = (skill: string)      => goStudents({ skill });

  const goSquad = (squadId: string) => {
    deliberate.current = true;
    setFocusSquad((f) => ({ id: squadId, n: (f?.n ?? 0) + 1 }));
    onTabChange?.("squads");
  };

  // Reaching a destination any other way — the sidebar, a quick action — is a
  // request for the whole thing, not for whatever was filtered last time.
  useEffect(() => {
    if (deliberate.current) { deliberate.current = false; return; }
    if (tab === "students") setIntent((i) => ({ n: i.n + 1 }));
    if (tab === "squads")   setFocusSquad(null);
  }, [tab]);

  const render = () => {
    switch (tab) {
      case "home":
        return <TpoHome onNavigate={onTabChange} onFilterStudents={goFiltered} onOpenSquad={goSquad} />;

      case "students":
        return (
          <TpoStudents
            filter={intent.filter}
            skill={intent.skill}
            intentKey={intent.n}
            onOpenSquad={goSquad}
          />
        );

      case "squads":
        return <TpoSquads focusSquad={focusSquad?.id ?? null} focusKey={focusSquad?.n ?? 0} />;

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
