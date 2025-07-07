
import { useState, useEffect } from "react";
import { Bell, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import ProfileCard from "@/components/dashboard/ProfileCard";
import ProgressChart from "@/components/dashboard/ProgressChart";
import XPTracker from "@/components/dashboard/XPTracker";
import TaskStats from "@/components/dashboard/TaskStats";
import AssignedTasksList from "@/components/dashboard/AssignedTasksList";
import ProofTracker from "@/components/dashboard/ProofTracker";
import NotificationsPopover from "@/components/dashboard/NotificationsPopover";
import LeaderboardSection from "@/components/dashboard/LeaderboardSection";
import TrustScorePanel from "@/components/dashboard/TrustScorePanel";

const StudentDashboard = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showNotifications, setShowNotifications] = useState(false);

  const studentData = {
    name: "Arjun Kumar",
    email: "arjun@example.com",
    profilePhoto: null,
    totalXp: 2450,
    trustScore: 85,
    rank: 17,
    totalStudents: 2847,
    monthlyXP: 650,
  };

  const menuTabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "tasks", label: "My Tasks" },
    { id: "upload", label: "Upload Proof" },
    { id: "portfolio", label: "Portfolio" },
    { id: "leaderboard", label: "Leaderboard" },
  ];

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

  const unreadNotifications = notifications.filter((n) => !n.isRead).length;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
      {/* Header Navigation */}
      <header className="bg-white/90 backdrop-blur-sm border-b border-orange-200/30 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          {/* Logo and Navigation */}
          <div className="flex items-center space-x-8">
            <div className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-bold text-lg">
              ProofLabAI
            </div>
            
            {/* Navigation Tabs */}
            <nav className="flex items-center space-x-1">
              {menuTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-gray-900 text-white shadow-lg'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Right Header Icons */}
          <div className="flex items-center space-x-4">
            {/* Notifications */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="relative p-3 hover:bg-white/60 rounded-xl"
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell className="h-5 w-5 text-gray-600" />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {unreadNotifications}
                  </span>
                )}
              </Button>
              {showNotifications && (
                <NotificationsPopover 
                  notifications={notifications}
                  onClose={() => setShowNotifications(false)}
                />
              )}
            </div>

            {/* Settings */}
            <Button variant="ghost" size="sm" className="p-3 hover:bg-white/60 rounded-xl">
              <Settings className="h-5 w-5 text-gray-600" />
            </Button>

            {/* User Avatar with Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-xl hover:bg-white/60">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={studentData.profilePhoto || ""} alt={studentData.name} />
                    <AvatarFallback className="bg-gray-900 text-white">
                      {studentData.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-white shadow-xl border-0 rounded-2xl" align="end">
                <DropdownMenuItem className="p-3 hover:bg-gray-50 rounded-xl m-1">
                  <Settings className="mr-3 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="p-3 hover:bg-gray-50 rounded-xl m-1">
                  <LogOut className="mr-3 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Welcome back, {studentData.name} 👋
          </h1>
          <p className="text-gray-500">{today}</p>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Left Column - Profile Card */}
          <div className="col-span-12 lg:col-span-3">
            <ProfileCard student={studentData} />
          </div>

          {/* Center Column */}
          <div className="col-span-12 lg:col-span-6 space-y-6">
            {/* Top Row: Progress Chart + XP Tracker + Trust Score */}
            <div className="grid grid-cols-3 gap-4">
              <ProgressChart />
              <XPTracker monthlyXP={studentData.monthlyXP} />
              <TrustScorePanel trustScore={studentData.trustScore} />
            </div>

            {/* Middle Row: Task Stats + Leaderboard */}
            <div className="grid grid-cols-2 gap-6">
              <TaskStats tasks={assignedTasks} />
              <LeaderboardSection rank={studentData.rank} totalStudents={studentData.totalStudents} />
            </div>

            {/* Bottom Row: Proof Tracker */}
            <ProofTracker />
          </div>

          {/* Right Column - Assigned Tasks */}
          <div className="col-span-12 lg:col-span-3">
            <AssignedTasksList tasks={assignedTasks} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default StudentDashboard;
