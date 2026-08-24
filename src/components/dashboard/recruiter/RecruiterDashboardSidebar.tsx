import {
  Home,
  Users,
  Bookmark,
  Boxes,
  LogOut,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RecruiterDashboardSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

// Four destinations, as the architecture specifies for every role. The proof
// profile is not among them: it opens over whichever section you found the
// candidate in, so you never lose your place reaching one.
const menuItems = [
  { id: "home",      label: "Home",      job: "See",     icon: Home },
  { id: "talent",    label: "Talent",    job: "Find",    icon: Users },
  { id: "shortlist", label: "Shortlist", job: "Decide",  icon: Bookmark },
  { id: "lots",      label: "Lots",      job: "Set work", icon: Boxes },
];

const RecruiterDashboardSidebar = ({ activeTab, onTabChange }: RecruiterDashboardSidebarProps) => {
  const { toast } = useToast();

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

export default RecruiterDashboardSidebar;