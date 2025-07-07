
import { Button } from "@/components/ui/button";

interface DashboardNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function DashboardNavigation({ activeTab, onTabChange }: DashboardNavigationProps) {
  const menuTabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "tasks", label: "My Tasks" },
    { id: "upload", label: "Upload Proof" },
    { id: "portfolio", label: "Portfolio" },
    { id: "leaderboard", label: "Leaderboard" },
  ];

  return (
    <nav className="flex items-center space-x-1">
      {menuTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
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
  );
}
