import { 
  LayoutDashboard, 
  Users, 
  ClipboardList, 
  Upload, 
  Shield, 
  Bell,
  Settings,
  User,
  LogOut,
  Link2,
  TrendingUp,
  Sliders,
  Package
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
  { id: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
  { id: "students", label: "Students", icon: Users },
  { id: "assign-tasks", label: "Assign Tasks", icon: ClipboardList },
  { id: "assign-pack", label: "Assign Task Pack", icon: Package },
  { id: "uploaded-proofs", label: "Uploaded Proofs", icon: Upload },
  { id: "trust-scores", label: "Trust Scores", icon: Shield },
  { id: "verification-trends", label: "Verification Trends", icon: TrendingUp },
  { id: "verification-settings", label: "Verification Settings", icon: Sliders },
  { id: "recruiter-links", label: "Recruiter Links", icon: Link2 },
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
    <aside className="sticky top-[64px] w-56 md:w-64 bg-card/80 backdrop-blur-sm border-r border-border h-[calc(100vh-64px)] overflow-y-auto">
      <nav className="p-3 md:p-4">
        <div className="space-y-1 md:space-y-2">
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
                  "w-full justify-start space-x-2 md:space-x-3 h-10 md:h-12 text-left text-xs md:text-sm relative",
                  activeTab === item.id 
                    ? "bg-primary/10 text-primary font-medium" 
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate flex-1">{item.label}</span>
                {showBadge && (
                  <Badge 
                    variant="destructive" 
                    className="ml-auto h-4 md:h-5 px-1 md:px-2 text-[10px]"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Badge>
                )}
              </Button>
            );
          })}
          
          {/* Sign Out Button */}
          <div className="pt-3 md:pt-4 mt-3 md:mt-4 border-t border-border">
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start space-x-2 md:space-x-3 h-10 md:h-12 text-left text-xs md:text-sm text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Sign Out</span>
            </Button>
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default CollegeDashboardSidebar;