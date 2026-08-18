import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import StudentUploadsPage from "./StudentUploadsPage";
import StudentPortfolioPage from "./StudentPortfolioPage";
import StudentProgressPage from "./StudentProgressPage";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentSettingsPage from "./StudentSettingsPage";
import StudentResumeCheckPage from "./StudentResumeCheckPage";
import StudentResumeHistoryPage from "./StudentResumeHistoryPage";
import StudentRoadmapPage from "./StudentRoadmapPage";
import SquadPlaceholder from "./SquadPlaceholder";

interface StudentDashboardContentProps {
  activeTab: string;
  refreshProfile?: () => void;
  onTabChange?: (tab: string) => void;
}

/**
 * Four destinations, from the product design deck.
 *
 * The deck is explicit about this and says it three times: Squad's four views
 * and Profile's three views are tabs INSIDE the destination, and a build-log
 * entry holds the work, the recording, the score and the feedback together
 * rather than scattering them across five menu items. So the routing here is
 * four cases, and everything that used to be its own sidebar entry is a tab.
 *
 * Old tab ids still resolve, so an old bookmark or a link from somewhere else
 * in the app lands in the right destination rather than on a blank screen.
 */
const LEGACY: Record<string, string> = {
  dashboard: "lab",
  feed: "lab",
  "tasks-assigned": "lab",
  "tasks-created": "lab",
  "create-task": "lab",
  uploads: "log",
  applications: "log",
  progress: "log",
  resume: "profile",
  "resume-history": "profile",
  "resume-roadmap": "profile",
  portfolio: "profile",
  settings: "profile",
  notifications: "profile",
  // Features whose tables were never rebuilt. They land on the nearest real
  // destination instead of rendering a page that queries nothing.
  "resume-jobmatch": "profile",
  "resume-certs": "profile",
  "tasks-opportunities": "lab",
  jobs: "lab",
  learning: "profile",
};

const StudentDashboardContent = ({ activeTab, refreshProfile }: StudentDashboardContentProps) => {
  const destination = ["lab", "log", "squad", "profile"].includes(activeTab)
    ? activeTab
    : LEGACY[activeTab] ?? "lab";

  // Each destination remembers which tab you were on while you are inside it.
  //
  // The starting tab comes from the URL, because /student/roadmap is a real
  // link people already have. Without this it resolved to Profile and opened
  // on Proof — so the roadmap was reachable only by knowing to click a tab
  // called something else. That looked exactly like the roadmap being broken.
  const { pathname } = useLocation();
  const [logTab, setLogTab] = useState("entries");
  const [profileTab, setProfileTab] = useState(
    pathname === "/student/roadmap" ? "roadmap" : "proof",
  );

  return (
    <div className={destination === "profile" && profileTab === "portfolio" ? "w-full" : "max-w-7xl mx-auto"}>
      {destination === "lab" && <StudentAssignedTasksPage />}

      {destination === "log" && (
        <Tabs value={logTab} onValueChange={setLogTab}>
          <TabsList>
            <TabsTrigger value="entries">Entries</TabsTrigger>
            <TabsTrigger value="progress">Progress</TabsTrigger>
          </TabsList>
          <TabsContent value="entries" className="mt-4">
            <StudentUploadsPage />
          </TabsContent>
          <TabsContent value="progress" className="mt-4">
            <StudentProgressPage />
          </TabsContent>
        </Tabs>
      )}

      {destination === "squad" && <SquadPlaceholder />}

      {destination === "profile" && (
        <Tabs value={profileTab} onValueChange={setProfileTab}>
          <TabsList>
            <TabsTrigger value="proof">Proof</TabsTrigger>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
            <TabsTrigger value="resume">Resume</TabsTrigger>
            <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="proof" className="mt-4">
            <StudentResumeHistoryPage />
          </TabsContent>
          <TabsContent value="roadmap" className="mt-4">
            <StudentRoadmapPage />
          </TabsContent>
          <TabsContent value="resume" className="mt-4">
            <StudentResumeCheckPage />
          </TabsContent>
          <TabsContent value="portfolio" className="mt-4">
            <StudentPortfolioPage />
          </TabsContent>
          <TabsContent value="settings" className="mt-4">
            <StudentSettingsPage refreshProfile={refreshProfile} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default StudentDashboardContent;
