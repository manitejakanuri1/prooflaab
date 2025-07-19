import { 
  LayoutDashboard, 
  ClipboardCheck, 
  Briefcase, 
  BookOpen, 
  Settings, 
  LogOut 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "proof-submissions", label: "Proof Submissions", icon: ClipboardCheck },
  { id: "manage-jobs", label: "Manage Jobs", icon: Briefcase },
  { id: "manage-resources", label: "Manage Resources", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings },
];

const AdminSidebar = ({ activeTab, onTabChange }: AdminSidebarProps) => {
  const handleSignOut = async () => {
    // TODO: Implement sign out functionality
    console.log("Sign out clicked");
  };

  return (
    <aside className="w-64 bg-white/80 backdrop-blur-sm border-r border-blue-200/30 h-[calc(100vh-64px)] md:h-[calc(100vh-80px)]">
      <nav className="p-4">
        <div className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant="ghost"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-full justify-start space-x-3 h-12 text-left text-sm md:text-base",
                  activeTab === item.id 
                    ? "bg-blue-100 text-blue-700 font-medium" 
                    : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                )}
              >
                <Icon className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </Button>
            );
          })}
          
          {/* Sign Out Button */}
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start space-x-3 h-12 text-left text-sm md:text-base text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <LogOut className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
              <span className="truncate">Sign Out</span>
            </Button>
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default AdminSidebar;