import { useState } from "react";
import DashboardNavigation from "@/components/dashboard/DashboardNavigation";
import DashboardHeaderActions from "@/components/dashboard/DashboardHeaderActions";
import DashboardWelcome from "@/components/dashboard/DashboardWelcome";
import DashboardGrid from "@/components/dashboard/DashboardGrid";

const StudentDashboard = () => {
  const [activeTab, setActiveTab] = useState("dashboard");

  const studentData = {
    name: "Arjun Kumar",
    email: "arjun@example.com",
    profilePhoto: null,
    totalXp: 2450,
    trustScore: 85,
    rank: 17,
    totalStudents: 2847,
  };

  const assignedTasks = [
    {
      id: "1",
      title: "Build React Dashboard",
      deadline: "Dec 15, 2024",
      status: "In Progress" as const,
      progress: 65,
    },
    {
      id: "2",
      title: "API Integration",
      deadline: "Dec 20, 2024",
      status: "Pending" as const,
      progress: 0,
    },
    {
      id: "3",
      title: "Database Schema",
      deadline: "Dec 10, 2024",
      status: "Completed" as const,
      progress: 100,
    },
  ];

  const notifications = [
    {
      id: "1",
      message: 'New task assigned: "Social Media Dashboard Development"',
      type: "task" as const,
      time: "2 hours ago",
      isRead: false,
    },
    {
      id: "2",
      message: "Feedback received on your React project submission",
      type: "feedback" as const,
      time: "5 hours ago",
      isRead: false,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
      {/* Header Navigation */}
      <header className="bg-white/90 backdrop-blur-sm border-b border-orange-200/30 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          {/* Logo */}
          <div className="text-gray-900 px-6 py-3 rounded-2xl font-bold text-lg flex items-center space-x-3">
            <img 
              src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
              alt="ProofLabAI Logo" 
              className="h-12 w-12"
            />
            <span>ProofLabAI</span>
          </div>
          
          {/* Navigation and Actions - moved to right */}
          <div className="flex items-center space-x-8">
            <DashboardNavigation 
              activeTab={activeTab} 
              onTabChange={setActiveTab} 
            />
            
            <DashboardHeaderActions 
              studentName={studentData.name}
              profilePhoto={studentData.profilePhoto}
              notifications={notifications}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        <DashboardWelcome studentName={studentData.name} />
        <DashboardGrid 
          studentData={studentData} 
          assignedTasks={assignedTasks} 
        />
      </main>
    </div>
  );
};

export default StudentDashboard;
