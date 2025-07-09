
import ProfileCardContainer from "@/components/dashboard/ProfileCardContainer";
import ProgressChart from "@/components/dashboard/ProgressChart";
import XPTracker from "@/components/dashboard/XPTracker";
import TaskStats from "@/components/dashboard/TaskStats";
import AssignedTasksList from "@/components/dashboard/AssignedTasksList";
import ProofTracker from "@/components/dashboard/ProofTracker";
import LeaderboardSection from "@/components/dashboard/LeaderboardSection";
import TrustScorePanel from "@/components/dashboard/TrustScorePanel";
import TasksWaitingForYou from "@/components/dashboard/TasksWaitingForYou";

interface Student {
  name: string;
  email: string;
  profilePhoto: string | null;
  totalXp: number;
  trustScore: number;
  rank: number;
  totalStudents: number;
}

interface Task {
  id: string;
  title: string;
  deadline: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  progress: number;
}

interface DashboardGridProps {
  studentData: Student;
  assignedTasks: Task[];
}

export default function DashboardGrid({ studentData, assignedTasks }: DashboardGridProps) {
  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left Column - Profile Card */}
      <div className="col-span-12 lg:col-span-3">
        <ProfileCardContainer />
      </div>

      {/* Center Column */}
      <div className="col-span-12 lg:col-span-6 space-y-6">
        {/* Top Row: Progress Chart + XP Tracker + Trust Score */}
        <div className="grid grid-cols-3 gap-4">
          <ProgressChart />
          <XPTracker />
          <TrustScorePanel trustScore={studentData.trustScore} />
        </div>

        {/* Middle Row: Assigned Tasks + Task Stats (swapped positions) */}
        <div className="grid grid-cols-2 gap-6">
          <AssignedTasksList tasks={assignedTasks} />
          <TaskStats />
        </div>

        {/* Bottom Row: Proof Tracker */}
        <ProofTracker />
      </div>

      {/* Right Column - Leaderboard + Tasks Waiting */}
      <div className="col-span-12 lg:col-span-3 space-y-6">
        <LeaderboardSection rank={studentData.rank} totalStudents={studentData.totalStudents} />
        <TasksWaitingForYou />
      </div>
    </div>
  );
}
