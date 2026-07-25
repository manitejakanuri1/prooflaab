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
  Package,
  BarChart3,
  Gavel
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

// Grouped into labelled sections so the 14 items read as a few small groups
// instead of one long list. `section: null` renders with no header (Overview).
const menuGroups = [
  {
    section: null,
    items: [
      { id: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    section: "Students",
    items: [
      { id: "students", label: "Students", icon: Users },
      { id: "assign-tasks", label: "Assign Tasks", icon: ClipboardList },
      { id: "assign-pack", label: "Assign Task Pack", icon: Package },
    ],
  },
  {
    section: "Verification",
    items: [
      { id: "uploaded-proofs", label: "Uploaded Proofs", icon: Upload },
      { id: "appeals", label: "Appeals Review", icon: Gavel },
      { id: "trust-scores", label: "Trust Scores", icon: Shield },
      { id: "verification-trends", label: "Verification Trends", icon: TrendingUp },
      { id: "verification-settings", label: "Verification Settings", icon: Sliders },
    ],
  },
  {
    section: "Growth",
    items: [
      { id: "pack-analytics", label: "Pack Analytics", icon: BarChart3 },
      { id: "recruiter-links", label: "Recruiter Links", icon: Link2 },
    ],
  },
  {
    section: "Account",
    items: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "profile", label: "My Profile", icon: User },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
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
        <div className="space-y-1">
          {menuGroups.map((group) => (
            <div key={group.section ?? "overview"} className="space-y-1">
              {group.section && (
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.section}
                </p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isNotifications = item.id === "notifications";
                const showBadge = isNotifications && unreadCount > 0;

                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    onClick={() => onTabChange(item.id)}
                    className={cn(
                      "w-full justify-start space-x-2 md:space-x-3 h-10 md:h-11 text-left text-xs md:text-sm relative",
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
            </div>
          ))}
          
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