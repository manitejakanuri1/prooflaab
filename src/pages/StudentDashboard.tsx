
import { useState } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import OverviewCards from "@/components/dashboard/OverviewCards";
import TasksSection from "@/components/dashboard/TasksSection";
import ProfileSection from "@/components/dashboard/ProfileSection";
import LeaderboardSection from "@/components/dashboard/LeaderboardSection";
import NotificationsSection from "@/components/dashboard/NotificationsSection";
import Sidebar from "@/components/dashboard/Sidebar";

const StudentDashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  // Mock data - in real app this would come from API/database
  const studentData = {
    name: "Arjun Kumar",
    email: "arjun@example.com",
    profilePhoto: null,
    totalXp: 2450,
    trustScore: 85,
    rank: 17,
    totalStudents: 2847
  };

  const overviewData = {
    tasksCompleted: 12,
    totalTasks: 18,
    xpPoints: 2450,
    trustScore: 85
  };

  const assignedTasks = [
    {
      id: '1',
      title: 'Build React Dashboard for E-commerce Platform',
      deadline: 'Dec 15, 2024',
      status: 'In Progress' as const,
      progress: 65,
      xpReward: 200
    },
    {
      id: '2', 
      title: 'API Integration for User Authentication',
      deadline: 'Dec 20, 2024',
      status: 'Pending' as const,
      progress: 0,
      xpReward: 150
    },
    {
      id: '3',
      title: 'Database Schema Design for CRM',
      deadline: 'Dec 10, 2024',
      status: 'Completed' as const,
      progress: 100,
      xpReward: 180
    }
  ];

  const notifications = [
    {
      id: '1',
      message: 'New task assigned: "Social Media Dashboard Development"',
      type: 'task' as const,
      time: '2 hours ago',
      isRead: false
    },
    {
      id: '2',
      message: 'Feedback received on your React project submission',
      type: 'feedback' as const,
      time: '5 hours ago',
      isRead: false
    },
    {
      id: '3',
      message: 'Congratulations! You earned the "Consistent Performer" badge',
      type: 'achievement' as const,
      time: '1 day ago',
      isRead: true
    }
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="p-6 max-w-7xl mx-auto">
            <DashboardHeader studentName={studentData.name} />
            
            {/* Main Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Left Column - Main Content */}
              <div className="lg:col-span-3 space-y-6">
                <OverviewCards data={overviewData} />
                <TasksSection tasks={assignedTasks} />
              </div>
              
              {/* Right Column - Sidebar Content */}
              <div className="space-y-6">
                <ProfileSection student={studentData} />
                <LeaderboardSection rank={studentData.rank} totalStudents={studentData.totalStudents} />
                <NotificationsSection notifications={notifications} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
