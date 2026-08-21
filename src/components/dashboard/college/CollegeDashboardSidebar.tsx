import {
  Home,
  Users,
  Swords,
  BarChart3,
  Bell,
  Settings,
  User,
  LogOut,
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

// Four destinations, each answering one question. Import, onboarding, the
// reserve pool, the leaderboard, the season, at-risk students and reports are
// all capabilities inside these four — not eleven entries competing for the
// same glance.
const menuItems = [
  { id: "home",     label: "Home",     job: "See",     icon: Home },
  { id: "students", label: "Students", job: "Manage",  icon: Users },
  { id: "squads",   label: "Squads",   job: "Compete", icon: Swords },
  { id: "insights", label: "Insights", job: "Act",     icon: BarChart3 },
];

// Account chrome. Kept out of the four so the menu stays a list of places to
// work rather than a list of everything that exists.
const footerItems = [
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "profile",       label: "My Profile",    icon: User },
  { id: "settings",      label: "Settings",      icon: Settings },
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
            const active = activeTab === item.id
              || (activeTab === "dashboard" && item.id === "home");

            return (
              <Button
                key={item.id}
                variant="ghost"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-full justify-start space-x-2 md:space-x-3 h-11 md:h-12 text-left text-xs md:text-sm relative",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate flex-1">{item.label}</span>
                <span className="hidden md:inline font-mono text-[9px] uppercase tracking-widest opacity-60">
                  {item.job}
                </span>
              </Button>
            );
          })}

          <div className="pt-3 md:pt-4 mt-3 md:mt-4 border-t border-border space-y-1">
            {footerItems.map((item) => {
              const Icon = item.icon;
              const showBadge = item.id === "notifications" && unreadCount > 0;
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    "w-full justify-start space-x-2 md:space-x-3 h-10 text-left text-xs md:text-sm",
                    activeTab === item.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                  {showBadge && (
                    <Badge variant="destructive" className="h-4 md:h-5 px-1 md:px-2 text-[10px]">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>

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