
import ProfileCardContainer from "./ProfileCardContainer";
import AssignedTasksList from "./AssignedTasksList";
import LeaderboardSection from "./LeaderboardSection";
import NotificationsSection from "./NotificationsSection";
import XPTracker from "./XPTracker";
import TrustScorePanel from "./TrustScorePanel";
import { useNotifications } from "@/hooks/useNotifications";

interface StudentData {
  name: string;
  email: string;
  profilePhoto: string | null;
  totalXp: number;
  trustScore: number;
  rank: number;
  totalStudents: number;
}

interface DashboardGridProps {
  studentData: StudentData;
}

export default function DashboardGrid({ studentData }: DashboardGridProps) {
  const { notifications = [] } = useNotifications();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mt-6">
      {/* Left Column - Profile & Stats */}
      <div className="xl:col-span-4 space-y-6">
        <div id="profile-section">
          <ProfileCardContainer />
        </div>
        
        <XPTracker />
        <TrustScorePanel />
      </div>

      {/* Center Column - Tasks & Activities */}
      <div className="xl:col-span-5 space-y-6">
        <div id="tasks-section">
          <AssignedTasksList />
        </div>
      </div>

      {/* Right Column - Leaderboard & Notifications */}
      <div className="xl:col-span-3 space-y-6">
        <LeaderboardSection />
        <NotificationsSection notifications={notifications} />
      </div>
    </div>
  );
}
