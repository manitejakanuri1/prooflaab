
import { useState } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import OverviewCards from "@/components/dashboard/OverviewCards";
import AssignedTasks from "@/components/dashboard/AssignedTasks";
import UploadedProofs from "@/components/dashboard/UploadedProofs";
import LeaderboardCard from "@/components/dashboard/LeaderboardCard";
import PortfolioCard from "@/components/dashboard/PortfolioCard";
import NotificationBox from "@/components/dashboard/NotificationBox";
import Sidebar from "@/components/dashboard/Sidebar";

const StudentDashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  // Mock data - in real app this would come from API/database
  const studentName = "Arjun";
  
  const overviewData = {
    tasksCompleted: 12,
    xpPoints: 2450,
    trustScore: 85
  };

  const assignedTasks = [
    {
      id: '1',
      title: 'Build React Dashboard for E-commerce Platform',
      deadline: 'Dec 15, 2024',
      status: 'In Progress' as const,
      progress: 65
    },
    {
      id: '2', 
      title: 'API Integration for User Authentication',
      deadline: 'Dec 20, 2024',
      status: 'Pending' as const,
      progress: 0
    },
    {
      id: '3',
      title: 'Database Schema Design for CRM',
      deadline: 'Dec 10, 2024',
      status: 'Completed' as const,
      progress: 100
    }
  ];

  const uploadedProofs = [
    {
      id: '1',
      taskTitle: 'Mobile App UI/UX Design',
      submissionDate: 'Dec 5, 2024',
      status: 'Verified' as const
    },
    {
      id: '2',
      taskTitle: 'Python Data Analysis Script',
      submissionDate: 'Dec 3, 2024', 
      status: 'Under Review' as const
    },
    {
      id: '3',
      taskTitle: 'WordPress Plugin Development',
      submissionDate: 'Nov 28, 2024',
      status: 'Rejected' as const
    }
  ];

  const leaderboardData = {
    rank: 17,
    badge: 'Top 10% Performer 🌟',
    totalStudents: 2847
  };

  const notifications = [
    {
      id: '1',
      message: 'New task assigned: "Social Media Dashboard Development"',
      type: 'task' as const,
      time: '2 hours ago'
    },
    {
      id: '2',
      message: 'Feedback received on your React project submission',
      type: 'feedback' as const,
      time: '5 hours ago'
    },
    {
      id: '3',
      message: 'Congratulations! You earned the "Consistent Performer" badge',
      type: 'achievement' as const,
      time: '1 day ago'
    }
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <DashboardHeader studentName={studentName} />
          
          <NotificationBox notifications={notifications} />
          
          <OverviewCards data={overviewData} />
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2">
              <AssignedTasks tasks={assignedTasks} />
              <UploadedProofs proofs={uploadedProofs} />
            </div>
            
            <div className="space-y-6">
              <LeaderboardCard data={leaderboardData} />
              <PortfolioCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
