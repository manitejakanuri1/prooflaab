import { useState } from "react";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useLocation } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentDailyCard from "./StudentDailyCard";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import BuildLogEntries from "./BuildLogEntries";
import StudentPortfolioPage from "./StudentPortfolioPage";
import StudentProgressPage from "./StudentProgressPage";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentSettingsPage from "./StudentSettingsPage";
import StudentResumeCheckPage from "./StudentResumeCheckPage";
import StudentResumeHistoryPage from "./StudentResumeHistoryPage";
import StudentRoadmapPage from "./StudentRoadmapPage";
import StudentSquadPage from "./StudentSquadPage";
import StudentAchievements from "./StudentAchievements";
import StudentSkillsProved from "./StudentSkillsProved";
import StudentHistory from "./StudentHistory";
import StudentCertifications from "./StudentCertifications";
import StudentPrivacy from "./StudentPrivacy";
import StudentRolePreference from "./StudentRolePreference";
import MockInterview from "./MockInterview";

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
  // The inner tab lives in the URL (?view=), so a refresh or a pasted link opens the same view.
  const [view, setView] = useUrlTab("view", "");
  const LOG = ["entries", "progress", "skills", "history"];
  const PROFILE = ["proof", "roadmap", "resume", "interview", "certifications", "achievements", "role", "portfolio", "privacy", "settings"];
  const logTab = LOG.includes(view) ? view : "entries";
  const profileTab = PROFILE.includes(view) ? view : pathname === "/student/roadmap" ? "roadmap" : "proof";
  const setLogTab = setView;
  const setProfileTab = setView;

  return (
    <div className={destination === "profile" && profileTab === "portfolio" ? "w-full" : "max-w-7xl mx-auto"}>
      {/* Floor: the Daily Card is the landing screen: today's Lot and two actions.
          The full task list sits underneath it for anything still open. */}
      {destination === "lab" && (
        <div className="space-y-8">
          <StudentDailyCard />
          <StudentAssignedTasksPage />
        </div>
      )}

      {destination === "log" && (
        <Tabs value={logTab} onValueChange={setLogTab}>
          {/* Build-log: Entries is the record of real work (task_submissions +
              voice). Cosigns and LeetCode/HackerRank streaks were retired
              3 Oct 2026; their server pieces go with Wave 8. */}
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="entries">Recent work</TabsTrigger>
            <TabsTrigger value="progress">Progress</TabsTrigger>
            <TabsTrigger value="skills">Skills evidence</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="entries" className="mt-4">
            <BuildLogEntries />
          </TabsContent>
          <TabsContent value="skills" className="mt-4">
            <StudentSkillsProved />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <StudentHistory />
          </TabsContent>
          <TabsContent value="progress" className="mt-4">
            <div className="space-y-6">
              <StudentProgressPage />
            </div>
          </TabsContent>
        </Tabs>
      )}

      {destination === "squad" && <StudentSquadPage />}

      {destination === "profile" && (
        <Tabs value={profileTab} onValueChange={setProfileTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="proof">Readiness</TabsTrigger>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
            <TabsTrigger value="resume">Resume</TabsTrigger>
            <TabsTrigger value="interview">Mock interview</TabsTrigger>
            <TabsTrigger value="certifications">Certifications</TabsTrigger>
            <TabsTrigger value="achievements">Badges</TabsTrigger>
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
          <TabsContent value="interview" className="mt-4">
            <MockInterview />
          </TabsContent>
          <TabsContent value="certifications" className="mt-4">
            <StudentCertifications />
          </TabsContent>
          <TabsContent value="achievements" className="mt-4">
            <StudentAchievements />
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
