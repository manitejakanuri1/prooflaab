import { 
  LayoutDashboard, 
  Users, 
  ClipboardList, 
  Upload, 
  Shield, 
  Bell 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CollegeDashboardSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "students", label: "Students", icon: Users },
  { id: "assign-tasks", label: "Assign Tasks", icon: ClipboardList },
  { id: "uploaded-proofs", label: "Uploaded Proofs", icon: Upload },
  { id: "trust-scores", label: "Trust Scores", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
];

const CollegeDashboardSidebar = ({ activeTab, onTabChange }: CollegeDashboardSidebarProps) => {
  return (
    <aside className="w-64 bg-white/80 backdrop-blur-sm border-r border-orange-200/30 h-[calc(100vh-64px)] md:h-[calc(100vh-80px)]">
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
                    ? "bg-orange-100 text-orange-700 font-medium" 
                    : "text-gray-600 hover:bg-orange-50 hover:text-orange-600"
                )}
              >
                <Icon className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </Button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
};

export default CollegeDashboardSidebar;