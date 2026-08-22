import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentDailyCard from "./StudentDailyCard";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import StudentUploadsPage from "./StudentUploadsPage";
import StudentPortfolioPage from "./StudentPortfolioPage";
import StudentProgressPage from "./StudentProgressPage";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentSettingsPage from "./StudentSettingsPage";
import StudentResumeCheckPage from "./StudentResumeCheckPage";
import StudentResumeHistoryPage from "./StudentResumeHistoryPage";
import StudentRoadmapPage from "./StudentRoadmapPage";
import StudentSquadPage from "./StudentSquadPage";
import CodingStreaks from "./CodingStreaks";
import StudentAchievements from "./StudentAchievements";
import StudentSkillsProved from "./StudentSkillsProved";
import StudentCosigns from "./StudentCosigns";
import StudentHistory from "./StudentHistory";
import StudentCertifications from "./StudentCertifications";
import StudentPrivacy from "./StudentPrivacy";
import StudentRolePreference from "./StudentRolePreference";

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
      {/* The Daily Card is the landing screen: today's Lot and two actions.
          The full task list sits underneath it for anything still open. */}
      {destination === "lab" && (
        <div className="space-y-8">
          <StudentDailyCard />
          <StudentAssignedTasksPage />
        </div>
      )}

      {destination === "log" && (
        <Tabs value={logTab} onValueChange={setLogTab}>
          {/* The six views the architecture puts inside Build-log. Entries,
              Progress and Badges were already here; Skills, Cosigns and History
              read tables that existed and had no reader. */}
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="entries">Entries</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="cosigns">Cosigns</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="progress">Progress</TabsTrigger>
            <TabsTrigger value="achievements">Badges &amp; Quests</TabsTrigger>
          </TabsList>
          <TabsContent value="entries" className="mt-4">
            <StudentUploadsPage />
          </TabsContent>
          <TabsContent value="skills" className="mt-4">
            <StudentSkillsProved />
          </TabsContent>
          <TabsContent value="cosigns" className="mt-4">
            <StudentCosigns />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <StudentHistory />
          </TabsContent>
          <TabsContent value="progress" className="mt-4">
            <div className="space-y-6">
              {/* Brought across from the other line of work: LeetCode and
                  HackerRank practice streaks, alongside the ProofLab record. */}
              <CodingStreaks />
              <StudentProgressPage />
            </div>
          </TabsContent>
          <TabsContent value="achievements" className="mt-4">
            <StudentAchievements />
          </TabsContent>
        </Tabs>
      )}

      {destination === "squad" && <StudentSquadPage />}

      {destination === "profile" && (
        <Tabs value={profileTab} onValueChange={setProfileTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="proof">Proof</TabsTrigger>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
            <TabsTrigger value="resume">Resume</TabsTrigger>
            <TabsTrigger value="certifications">Certifications</TabsTrigger>
            <TabsTrigger value="role">Role preference</TabsTrigger>
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
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
          <TabsContent value="certifications" className="mt-4">
            <StudentCertifications />
          </TabsContent>
          <TabsContent value="role" className="mt-4">
            <StudentRolePreference />
          </TabsContent>
          <TabsContent value="privacy" className="mt-4">
            <StudentPrivacy />
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
