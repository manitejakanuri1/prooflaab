import { 
  LayoutDashboard, 
  Users, 
  ClipboardList, 
  Upload, 
  Shield, 
  Bell,
  Settings,
  User,
  LogOut
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCollegeNotifications } from "@/hooks/useCollegeNotifications";

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
  { id: "profile", label: "My Profile", icon: User },
  { id: "settings", label: "Settings", icon: Settings },
];

const CollegeDashboardSidebar = ({ activeTab, onTabChange }: CollegeDashboardSidebarProps) => {
  const { toast } = useToast();
  const { unreadCount } = useCollegeNotifications();

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      // Clear any cached data
      window.location.href = '/auth';
    } catch (error) {
      console.error('Error signing out:', error);
      toast({
        title: "Error",
        description: "Failed to sign out. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <aside className="w-64 bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm border-r border-orange-200/30 dark:border-gray-700 h-[calc(100vh-64px)] md:h-[calc(100vh-80px)]">
      <nav className="p-4">
        <div className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isNotifications = item.id === "notifications";
            const showBadge = isNotifications && unreadCount > 0;
            
            return (
              <Button
                key={item.id}
                variant="ghost"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-full justify-start space-x-3 h-12 text-left text-sm md:text-base relative",
                  activeTab === item.id 
                    ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium" 
                    : "text-gray-600 dark:text-gray-300 hover:bg-orange-50 dark:hover:bg-gray-700 hover:text-orange-600 dark:hover:text-orange-400"
                )}
              >
                <Icon className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
                {showBadge && (
                  <Badge 
                    variant="destructive" 
                    className="ml-auto h-5 px-2 text-[10px]"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Badge>
                )}
              </Button>
            );
          })}
          
          {/* Sign Out Button */}
          <div className="pt-4 mt-4 border-t border-orange-200/30 dark:border-gray-700">
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start space-x-3 h-12 text-left text-sm md:text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300"
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

export default CollegeDashboardSidebar;